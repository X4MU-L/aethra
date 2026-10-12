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

/**
 * Claim exclusive ownership of an upstream Agentation session for a client workspace.
 *
 * Invariant: Atomic check and claim using an IMMEDIATE SQLite transaction.
 * - If unowned: claims session and records ownership.
 * - If already owned by same clientSlug: succeeds idempotently, updating workspacePath and updatedAt.
 * - If owned by another client: throws VisualFeedbackError and makes no modification.
 */
export function claimSessionOwnership(
  agentationSessionId: string,
  clientSlug: string,
  workspacePath: string,
): { claimed: boolean; existing: boolean } {
  const db = getGlobalRegistryDb();

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
        if (existing.client_slug === slug) {
          // Idempotent: already owned by this client. Update workspace path and timestamp.
          db.prepare(
            "UPDATE session_ownership SET workspace_path = ?, updated_at = ? WHERE agentation_session_id = ?",
          ).run(wsPath, new Date().toISOString(), sessionId);
          return { claimed: true, existing: true };
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

  return claimTx.immediate(agentationSessionId, clientSlug, workspacePath);
}

/**
 * Safely release session ownership for a client.
 *
 * Invariant: A client can only release its own session.
 * Attempting to release a session owned by another client fails safely.
 */
export function releaseSessionOwnership(
  agentationSessionId: string,
  clientSlug: string,
): boolean {
  const db = getGlobalRegistryDb();

  const releaseTx = db.transaction((sessionId: string, slug: string) => {
    const existing = db
      .prepare(
        "SELECT client_slug FROM session_ownership WHERE agentation_session_id = ?",
      )
      .get(sessionId) as { client_slug: string } | undefined;

    if (!existing) {
      return false;
    }

    if (existing.client_slug !== slug) {
      logger.warn(
        `Security: client "${slug}" attempted to release session "${sessionId}" owned by "${existing.client_slug}"`,
      );
      return false;
    }

    db.prepare(
      "DELETE FROM session_ownership WHERE agentation_session_id = ?",
    ).run(sessionId);
    return true;
  });

  return releaseTx.immediate(agentationSessionId, clientSlug);
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
 * Synchronize legacy session mappings into the global registry during initialization.
 * Ensures workspaces created prior to the global registry are safely registered.
 */
export function syncLegacySessionMappings(
  localDb: Database.Database,
  workspacePath: string,
): void {
  try {
    const rows = localDb
      .prepare(
        "SELECT agentation_session_id, client_slug, workspace_path FROM session_mappings",
      )
      .all() as Array<{
      agentation_session_id: string;
      client_slug: string;
      workspace_path: string;
    }>;

    for (const row of rows) {
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
  } catch {
    // If local session_mappings does not exist, ignore
  }
}
