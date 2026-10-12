/**
 * Global session ownership registry for Aethra.
 *
 * Enforces cross-workspace session isolation across all client workspaces
 * on the host installation. Guarantees that one upstream Agentation session
 * cannot be claimed by multiple client workspaces.
 *
 * Persistence: <AETHRA_HOME>/session-registry.db
 * Uses SQLite WAL mode and IMMEDIATE transactions for atomic concurrency control.
 */

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs-extra";
import { logger } from "../core/logger.js";
import { VisualFeedbackError } from "../core/errors.js";

export interface SessionOwner {
  agentationSessionId: string;
  clientSlug: string;
  workspacePath: string;
  claimedAt: string;
  updatedAt: string;
}

let _registryDb: Database.Database | null = null;
let _customRegistryPath: string | null = null;

/** Resolve Aethra home directory, supporting AETHRA_HOME env override. */
export function getAethraHome(): string {
  return process.env.AETHRA_HOME || path.join(os.homedir(), ".aethra");
}

/** Override registry DB path (primarily for testing and isolation). */
export function setGlobalRegistryPath(customPath: string | null): void {
  if (_registryDb) {
    _registryDb.close();
    _registryDb = null;
  }
  _customRegistryPath = customPath;
}

/** Get resolved path to global session registry database. */
export function getGlobalRegistryPath(): string {
  if (_customRegistryPath) {
    return _customRegistryPath;
  }
  return path.join(getAethraHome(), "session-registry.db");
}

/** Get or initialize the global session ownership registry database. */
export function getGlobalRegistryDb(): Database.Database {
  if (_registryDb) {
    return _registryDb;
  }

  const dbPath = getGlobalRegistryPath();
  if (dbPath !== ":memory:") {
    fs.ensureDirSync(path.dirname(dbPath));
  }

  const db = new Database(dbPath);
  if (dbPath !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  db.pragma("busy_timeout = 5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_ownership (
      agentation_session_id TEXT PRIMARY KEY,
      client_slug TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      claimed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_ownership_client ON session_ownership(client_slug);
  `);

  _registryDb = db;
  return db;
}

/** Close the global session registry database handle. */
export function closeGlobalRegistry(): void {
  if (_registryDb) {
    try {
      _registryDb.close();
    } catch {
      // ignore
    }
    _registryDb = null;
  }
}

/** Clear all global session ownership records (useful for test isolation). */
export function clearGlobalRegistry(): void {
  const db = getGlobalRegistryDb();
  db.exec("DELETE FROM session_ownership;");
}

/** Normalize a workspace path to a canonical absolute path, safely resolving symlinks. */
export function normalizeWorkspacePath(wsPath: string): string {
  try {
    const resolved = path.resolve(wsPath);
    if (fs.existsSync(resolved)) {
      try {
        return fs.realpathSync.native(resolved);
      } catch {
        return fs.realpathSync(resolved);
      }
    }
    // Resolve symlinks on existing ancestor directory if wsPath does not exist yet
    let current = resolved;
    const segments: string[] = [];
    while (current !== path.dirname(current)) {
      if (fs.existsSync(current)) {
        try {
          const realParent = fs.realpathSync.native(current);
          return path.join(realParent, ...segments);
        } catch {
          const realParent = fs.realpathSync(current);
          return path.join(realParent, ...segments);
        }
      }
      segments.unshift(path.basename(current));
      current = path.dirname(current);
    }
    return resolved;
  } catch {
    return path.resolve(wsPath);
  }
}

/**
 * Claim exclusive ownership of an upstream Agentation session for a client workspace.
 *
 * Invariant: Atomic check and claim using an IMMEDIATE SQLite transaction.
 * - If unowned: claims session and records ownership.
 * - If already owned by same clientSlug AND same canonical workspace: succeeds idempotently.
 * - If owned by same clientSlug but different workspace: throws VisualFeedbackError (no silent transfer).
 * - If owned by another client: throws VisualFeedbackError and makes no modification.
 */
export function claimSessionOwnership(
  agentationSessionId: string,
  clientSlug: string,
  workspacePath: string,
): { claimed: boolean; existing: boolean } {
  const db = getGlobalRegistryDb();
  const canonicalPath = normalizeWorkspacePath(workspacePath);

  const claimTx = db.transaction(
    (sessionId: string, slug: string, wsPath: string) => {
      const existing = db
        .prepare(
          "SELECT agentation_session_id, client_slug, workspace_path, claimed_at, updated_at FROM session_ownership WHERE agentation_session_id = ?",
        )
        .get(sessionId) as
        | {
            agentation_session_id: string;
            client_slug: string;
            workspace_path: string;
            claimed_at: string;
            updated_at: string;
          }
        | undefined;

      if (existing) {
        const existingCanonical = normalizeWorkspacePath(existing.workspace_path);

        if (existing.client_slug === slug && existingCanonical === wsPath) {
          // Idempotent: already owned by this client and this exact workspace.
          db.prepare(
            "UPDATE session_ownership SET updated_at = ? WHERE agentation_session_id = ?",
          ).run(new Date().toISOString(), sessionId);
          return { claimed: true, existing: true };
        }

        if (existing.client_slug === slug && existingCanonical !== wsPath) {
          // Same client slug but different workspace path: reject silent transfer!
          throw new VisualFeedbackError(
            `Agentation session "${sessionId}" is already owned by client "${slug}" in workspace "${existing.workspace_path}" and cannot be claimed by workspace "${wsPath}".`,
          );
        }

        // Owned by a different client across the installation!
        throw new VisualFeedbackError(
          `Agentation session "${sessionId}" is already owned by client "${existing.client_slug}" (workspace: "${existing.workspace_path}") and cannot be claimed by "${slug}".`,
        );
      }

      // Unowned session: claim atomically
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO session_ownership (agentation_session_id, client_slug, workspace_path, claimed_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(sessionId, slug, wsPath, now, now);

      return { claimed: true, existing: false };
    },
  );

  return claimTx.immediate(agentationSessionId, clientSlug, canonicalPath);
}

/**
 * Safely release session ownership for a client.
 *
 * Invariant: A client can only release its own session from the rightful workspace.
 * Attempting to release a session owned by another client or different workspace fails safely.
 */
export function releaseSessionOwnership(
  agentationSessionId: string,
  clientSlug: string,
  workspacePath?: string,
): boolean {
  const db = getGlobalRegistryDb();

  const releaseTx = db.transaction((sessionId: string, slug: string, wsPath?: string) => {
    const existing = db
      .prepare(
        "SELECT client_slug, workspace_path FROM session_ownership WHERE agentation_session_id = ?",
      )
      .get(sessionId) as { client_slug: string; workspace_path: string } | undefined;

    if (!existing) {
      return false;
    }

    if (existing.client_slug !== slug) {
      logger.warn(
        `Security: client "${slug}" attempted to release session "${sessionId}" owned by "${existing.client_slug}"`,
      );
      return false;
    }

    if (wsPath) {
      const canonicalReq = normalizeWorkspacePath(wsPath);
      const canonicalOwner = normalizeWorkspacePath(existing.workspace_path);
      if (canonicalReq !== canonicalOwner) {
        logger.warn(
          `Security: workspace "${canonicalReq}" attempted to release session "${sessionId}" owned by workspace "${canonicalOwner}"`,
        );
        return false;
      }
    }

    db.prepare(
      "DELETE FROM session_ownership WHERE agentation_session_id = ?",
    ).run(sessionId);
    return true;
  });

  return releaseTx.immediate(agentationSessionId, clientSlug, workspacePath);
}

/** Get current owner of a session across the installation. */
export function getGlobalSessionOwner(
  agentationSessionId: string,
): SessionOwner | null {
  const db = getGlobalRegistryDb();
  const row = db
    .prepare(
      "SELECT agentation_session_id, client_slug, workspace_path, claimed_at, updated_at FROM session_ownership WHERE agentation_session_id = ?",
    )
    .get(agentationSessionId) as
    | {
        agentation_session_id: string;
        client_slug: string;
        workspace_path: string;
        claimed_at: string;
        updated_at: string;
      }
    | undefined;

  if (!row) return null;
  return {
    agentationSessionId: row.agentation_session_id,
    clientSlug: row.client_slug,
    workspacePath: row.workspace_path,
    claimedAt: row.claimed_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Authoritative session authorization check.
 *
 * Invariants:
 * 1. Global ownership record exists.
 * 2. Registry record's owner matches the current workspace identity.
 * 3. Registry record's client identity matches the current client.
 * 4. Workspace-local session mapping exists and agrees with the global record (if localDb supplied).
 */
export function verifySessionAuthorization(
  sessionId: string,
  clientSlug: string,
  workspacePath: string,
  localDb?: Database.Database,
): { authorized: boolean; reason?: string } {
  if (!sessionId || !clientSlug || !workspacePath) {
    return {
      authorized: false,
      reason: "Missing session ID, client slug, or workspace path for authorization check",
    };
  }

  // 1. Check global ownership record
  const globalOwner = getGlobalSessionOwner(sessionId);
  if (!globalOwner) {
    return {
      authorized: false,
      reason: `No global ownership claim exists for session "${sessionId}"`,
    };
  }

  // 2. Check canonical workspace identity
  const currentCanonical = normalizeWorkspacePath(workspacePath);
  const ownerCanonical = normalizeWorkspacePath(globalOwner.workspacePath);
  if (currentCanonical !== ownerCanonical) {
    return {
      authorized: false,
      reason: `Session "${sessionId}" is globally owned by workspace "${globalOwner.workspacePath}", not "${workspacePath}"`,
    };
  }

  // 3. Check client identity
  if (globalOwner.clientSlug !== clientSlug) {
    return {
      authorized: false,
      reason: `Session "${sessionId}" is globally owned by client "${globalOwner.clientSlug}", not "${clientSlug}"`,
    };
  }

  // 4. Check workspace-local mapping
  if (localDb) {
    try {
      const row = localDb
        .prepare(
          "SELECT client_slug FROM session_mappings WHERE agentation_session_id = ?",
        )
        .get(sessionId) as { client_slug: string } | undefined;

      if (!row) {
        return {
          authorized: false,
          reason: `Session "${sessionId}" is not mapped in workspace-local database`,
        };
      }

      if (row.client_slug !== clientSlug) {
        return {
          authorized: false,
          reason: `Session "${sessionId}" is locally mapped to client "${row.client_slug}", conflicting with "${clientSlug}"`,
        };
      }
    } catch (err) {
      return {
        authorized: false,
        reason: `Failed to verify workspace-local session mapping: ${(err as Error).message}`,
      };
    }
  }

  return { authorized: true };
}

/**
 * Synchronize legacy session mappings into the global registry during initialization.
 * Ensures workspaces created prior to the global registry are safely registered.
 *
 * Conflict Policy:
 * 1. If mapping matches global registry or session is unowned: preserved.
 * 2. If global registry identifies another owner: immediately quarantines conflicting
 *    local mapping from session_mappings so it cannot authorize access.
 * 3. Records diagnostics in quarantined_session_mappings for operator inspection.
 */
export function syncLegacySessionMappings(
  localDb: Database.Database,
  workspacePath: string,
): void {
  try {
    localDb.exec(`
      CREATE TABLE IF NOT EXISTS quarantined_session_mappings (
        agentation_session_id TEXT PRIMARY KEY,
        client_slug TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        conflicted_owner TEXT NOT NULL,
        quarantined_at TEXT NOT NULL,
        reason TEXT NOT NULL
      );
    `);

    const rows = localDb
      .prepare(
        "SELECT agentation_session_id, client_slug, workspace_path FROM session_mappings",
      )
      .all() as Array<{
      agentation_session_id: string;
      client_slug: string;
      workspace_path: string;
    }>;

    const canonicalCurrent = normalizeWorkspacePath(workspacePath);

    for (const row of rows) {
      const existingOwner = getGlobalSessionOwner(row.agentation_session_id);

      if (existingOwner) {
        const canonicalOwner = normalizeWorkspacePath(existingOwner.workspacePath);
        const matchesClient = existingOwner.clientSlug === row.client_slug;
        const matchesWorkspace = canonicalOwner === canonicalCurrent;

        if (matchesClient && matchesWorkspace) {
          // Ownership matches and is consistent
          continue;
        }

        // Conflict: owned by another client or different workspace!
        // Prevent unauthorized access by immediately removing from local active session_mappings
        localDb.prepare(
          "DELETE FROM session_mappings WHERE agentation_session_id = ?",
        ).run(row.agentation_session_id);

        localDb.prepare(
          `INSERT OR REPLACE INTO quarantined_session_mappings
           (agentation_session_id, client_slug, workspace_path, conflicted_owner, quarantined_at, reason)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          row.agentation_session_id,
          row.client_slug,
          row.workspace_path || workspacePath,
          JSON.stringify(existingOwner),
          new Date().toISOString(),
          `Conflict with global owner: client "${existingOwner.clientSlug}" in "${existingOwner.workspacePath}"`,
        );

        logger.warn(
          `Legacy session conflict: quarantined local mapping for "${row.agentation_session_id}" (conflicted with ${existingOwner.clientSlug} in ${existingOwner.workspacePath}). Remediation: register a new session or inspect quarantined_session_mappings.`,
        );
      } else {
        // Unclaimed session: attempt to claim for this workspace
        try {
          claimSessionOwnership(
            row.agentation_session_id,
            row.client_slug,
            row.workspace_path || workspacePath,
          );
        } catch (err) {
          logger.debug(
            `Legacy session sync skipped for ${row.agentation_session_id}: ${(err as Error).message}`,
          );
        }
      }
    }
  } catch {
    // If local session_mappings does not exist, ignore
  }
}
