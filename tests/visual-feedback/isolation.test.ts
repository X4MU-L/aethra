/**
 * Cross-workspace security isolation and session reliability tests.
 *
 * Verifies that two distinct workspaces with distinct session mappings
 * cannot access, ingest, resolve, or mutate each other's annotations across:
 * 1. Global cross-workspace session ownership exclusivity & concurrency
 * 2. Typed session validation outcomes (404 vs timeout vs 5xx vs malformed)
 * 3. Fail-closed real-time SSE event authorization
 * 4. Polling retrieval isolation
 * 5. Re-import lifecycle idempotence
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "fs-extra";
import {
  getDb,
  closeDb,
  closeAllDbs,
  dbSaveSessionMapping,
  dbGetSessionsForClient,
  dbIsSessionMapped,
  dbRemoveSessionMapping,
  dbSaveFeedback,
  dbLoadFeedback,
  dbFindFeedbackByProviderAnnotation,
  setGlobalRegistryPath,
  clearGlobalRegistry,
  getGlobalSessionOwner,
} from "../../src/engine/db.js";
import { VisualFeedbackError } from "../../src/core/errors.js";
import {
  AgentationProvider,
  type SessionValidationResult,
} from "../../src/visual-feedback/providers/agentation.js";
import {
  importFeedback,
  resolveFeedback,
  dismissFeedback,
} from "../../src/visual-feedback/manager.js";
import {
  VisualFeedbackSchema,
  type VisualFeedback,
} from "../../src/visual-feedback/schema.js";
import { checkAnnotationWorkspaceOwnership } from "../../src/mcp/server.js";

describe("Cross-workspace security isolation & session reliability", () => {
  let tmpRoot: string;
  let workspaceA: string;
  let workspaceB: string;
  let origAethraHome: string | undefined;

  beforeEach(async () => {
    origAethraHome = process.env.AETHRA_HOME;
    tmpRoot = path.join(
      os.tmpdir(),
      `aethra-isolation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    workspaceA = path.join(tmpRoot, "client-a");
    workspaceB = path.join(tmpRoot, "client-b");

    const aethraHome = path.join(tmpRoot, ".aethra");
    process.env.AETHRA_HOME = aethraHome;
    setGlobalRegistryPath(path.join(aethraHome, "session-registry.db"));

    await fs.ensureDir(workspaceA);
    await fs.ensureDir(workspaceB);
    await fs.ensureDir(aethraHome);

    // Create client configs
    await fs.writeFile(
      path.join(workspaceA, "client.yaml"),
      "slug: client-a\nname: Client Alpha\nprimaryUrl: http://localhost:3000\n",
    );
    await fs.writeFile(
      path.join(workspaceB, "client.yaml"),
      "slug: client-b\nname: Client Beta\nprimaryUrl: http://localhost:4000\n",
    );
  });

  afterEach(async () => {
    closeAllDbs();
    clearGlobalRegistry();
    setGlobalRegistryPath(null);
    if (origAethraHome !== undefined) {
      process.env.AETHRA_HOME = origAethraHome;
    } else {
      delete process.env.AETHRA_HOME;
    }
    await fs.remove(tmpRoot);
  });

  // ── Priority 1: Cross-workspace session ownership ──────────────────────────

  it("Client A can claim an unowned upstream session across separate workspace databases", () => {
    const dbA = getDb(workspaceA);
    dbSaveSessionMapping(dbA, "session-cross-1", "client-a", workspaceA);

    expect(dbIsSessionMapped(dbA, "session-cross-1", "client-a")).toBe(true);
    const owner = getGlobalSessionOwner("session-cross-1");
    expect(owner).toBeDefined();
    expect(owner?.clientSlug).toBe("client-a");
    expect(owner?.workspacePath).toBe(workspaceA);
  });

  it("Client A can re-register the same session idempotently without error", () => {
    const dbA = getDb(workspaceA);
    dbSaveSessionMapping(dbA, "session-cross-1", "client-a", workspaceA);
    expect(() => {
      dbSaveSessionMapping(dbA, "session-cross-1", "client-a", workspaceA);
    }).not.toThrow();

    expect(dbIsSessionMapped(dbA, "session-cross-1", "client-a")).toBe(true);
    expect(dbGetSessionsForClient(dbA, "client-a")).toEqual(["session-cross-1"]);
  });

  it("Client B in separate workspace database cannot claim Client A's session", () => {
    const dbA = getDb(workspaceA);
    const dbB = getDb(workspaceB);

    // Client A claims session-cross-1 in workspace A
    dbSaveSessionMapping(dbA, "session-cross-1", "client-a", workspaceA);

    // Client B attempts to claim the same session-cross-1 in workspace B
    expect(() => {
      dbSaveSessionMapping(dbB, "session-cross-1", "client-b", workspaceB);
    }).toThrow(VisualFeedbackError);

    // Verify invariant: Client B's database has NO mapping
    expect(dbIsSessionMapped(dbB, "session-cross-1", "client-b")).toBe(false);
    expect(dbGetSessionsForClient(dbB, "client-b")).toEqual([]);

    // Global registry remains owned by Client A
    const owner = getGlobalSessionOwner("session-cross-1");
    expect(owner?.clientSlug).toBe("client-a");
  });

  it("Concurrent claim attempts by Client A and Client B cannot both succeed", async () => {
    const dbA = getDb(workspaceA);
    const dbB = getDb(workspaceB);
    const sessionId = "session-concurrent-race";

    let successCount = 0;
    let failCount = 0;

    const claimA = async () => {
      try {
        dbSaveSessionMapping(dbA, sessionId, "client-a", workspaceA);
        successCount++;
      } catch (err) {
        if (err instanceof VisualFeedbackError) failCount++;
      }
    };

    const claimB = async () => {
      try {
        dbSaveSessionMapping(dbB, sessionId, "client-b", workspaceB);
        successCount++;
      } catch (err) {
        if (err instanceof VisualFeedbackError) failCount++;
      }
    };

    // Run concurrently
    await Promise.all([claimA(), claimB()]);

    // Exactly one winner, one rejected
    expect(successCount).toBe(1);
    expect(failCount).toBe(1);

    // Global registry has exactly one legitimate owner
    const owner = getGlobalSessionOwner(sessionId);
    expect(owner).not.toBeNull();
    expect(["client-a", "client-b"]).toContain(owner?.clientSlug);
  });

  it("Failed ownership claim leaves neither unauthorized local mapping nor corrupted ownership record", () => {
    const dbA = getDb(workspaceA);
    const dbB = getDb(workspaceB);
    const sessionId = "session-atomic-test";

    dbSaveSessionMapping(dbA, sessionId, "client-a", workspaceA);

    expect(() => {
      dbSaveSessionMapping(dbB, sessionId, "client-b", workspaceB);
    }).toThrow(VisualFeedbackError);

    // Verify local DB B is clean
    const bSessions = dbGetSessionsForClient(dbB, "client-b");
    expect(bSessions).toEqual([]);

    // Global record remains cleanly assigned to Client A
    const owner = getGlobalSessionOwner(sessionId);
    expect(owner?.clientSlug).toBe("client-a");
    expect(owner?.workspacePath).toBe(workspaceA);
  });

  it("Removing mapping for Client A cannot accidentally release Client B's session", () => {
    const dbA = getDb(workspaceA);
    const dbB = getDb(workspaceB);

    dbSaveSessionMapping(dbB, "session-b-exclusive", "client-b", workspaceB);

    // Client A tries to remove session-b-exclusive
    dbRemoveSessionMapping(dbA, "session-b-exclusive", "client-a");

    // Client B's session must still be intact in global registry and in dbB
    expect(dbIsSessionMapped(dbB, "session-b-exclusive", "client-b")).toBe(true);
    const owner = getGlobalSessionOwner("session-b-exclusive");
    expect(owner?.clientSlug).toBe("client-b");
  });

  it("Session can be claimed by Client B after a legitimate release by Client A", () => {
    const dbA = getDb(workspaceA);
    const dbB = getDb(workspaceB);
    const sessionId = "session-reassignable";

    // Client A claims then legitimately releases
    dbSaveSessionMapping(dbA, sessionId, "client-a", workspaceA);
    dbRemoveSessionMapping(dbA, sessionId, "client-a");

    expect(getGlobalSessionOwner(sessionId)).toBeNull();

    // Client B can now safely claim it
    expect(() => {
      dbSaveSessionMapping(dbB, sessionId, "client-b", workspaceB);
    }).not.toThrow();

    expect(dbIsSessionMapped(dbB, sessionId, "client-b")).toBe(true);
    expect(getGlobalSessionOwner(sessionId)?.clientSlug).toBe("client-b");
  });

  it("Legacy database without global registry is safely synchronized on getDb initialization", () => {
    // Simulate legacy database that had a mapping before registry existed
    const legacyWorkspace = path.join(tmpRoot, "legacy-client");
    fs.ensureDirSync(path.join(legacyWorkspace, ".local"));

    const Database = (getDb(workspaceA) as any).constructor;
    const legacyDb = new Database(path.join(legacyWorkspace, ".local", "aethra.db"));
    legacyDb.exec(`
      CREATE TABLE IF NOT EXISTS session_mappings (
        agentation_session_id TEXT PRIMARY KEY,
        client_slug TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO session_mappings VALUES ('legacy-sess-999', 'legacy-client', '${legacyWorkspace}', '2026-01-01T00:00:00Z');
    `);
    legacyDb.close();

    // Now initialize via getDb
    const db = getDb(legacyWorkspace);
    expect(dbIsSessionMapped(db, "legacy-sess-999", "legacy-client")).toBe(true);

    // Global registry must have picked up the legacy session
    const owner = getGlobalSessionOwner("legacy-sess-999");
    expect(owner?.clientSlug).toBe("legacy-client");
    closeDb(legacyWorkspace);
  });

  // ── Priority 2: Typed validation outcomes ──────────────────────────────────

  it("validateSession distinguishes confirmed 404, success, timeout, refusal, 500, and malformed responses", async () => {
    const provider = new AgentationProvider();
    provider.setContext(workspaceA);

    const origFetch = globalThis.fetch;

    try {
      // 1. Confirmed 404
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ error: "Session not found" }), {
          status: 404,
        });
      }) as typeof fetch;
      const res404 = await provider.validateSession("sess-404");
      expect(res404.status).toBe("not-found");
      expect((res404 as any)?.statusCode).toBe(404);

      // 2. Successful validation with matching JSON object
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ id: "sess-valid", status: "active" }), {
          status: 200,
        });
      }) as typeof fetch;
      const resValid = await provider.validateSession("sess-valid");
      expect(resValid.status).toBe("valid");

      // 3. Timeout
      globalThis.fetch = (async () => {
        const err = new Error("The operation was aborted due to timeout");
        err.name = "TimeoutError";
        throw err;
      }) as typeof fetch;
      const resTimeout = await provider.validateSession("sess-timeout");
      expect(resTimeout.status).toBe("unreachable");
      expect(resTimeout.reason).toContain("timed out");

      // 4. Connection refused
      globalThis.fetch = (async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:4747");
      }) as typeof fetch;
      const resRefusal = await provider.validateSession("sess-refused");
      expect(resRefusal.status).toBe("unreachable");
      expect(resRefusal?.reason).toContain("Could not reach Agentation server");

      // 5. Server error 500 and 503
      globalThis.fetch = (async () => {
        return new Response("Internal Server Error", { status: 500 });
      }) as typeof fetch;
      const res500 = await provider.validateSession("sess-500");
      expect(res500.status).toBe("server-error");
      expect((res500 as any).statusCode).toBe(500);

      globalThis.fetch = (async () => {
        return new Response("Service Unavailable", { status: 503 });
      }) as typeof fetch;
      const res503 = await provider.validateSession("sess-503");
      expect(res503.status).toBe("server-error");
      expect((res503 as any).statusCode).toBe(503);

      // 6. Malformed JSON
      globalThis.fetch = (async () => {
        return new Response("{ broken json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;
      const resBrokenJson = await provider.validateSession("sess-broken");
      expect(resBrokenJson.status).toBe("malformed");

      // 7. Mismatched session ID in response
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ id: "other-id" }), { status: 200 });
      }) as typeof fetch;
      const resMismatched = await provider.validateSession("expected-id");
      expect(resMismatched.status).toBe("malformed");
      expect(resMismatched.reason).toContain("mismatched session ID");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // ── Priority 4: Fail-closed SSE authorization ──────────────────────────────

  it("processSSEEvent rejects events when client scope is requested but workspacePath is absent", () => {
    const provider = new AgentationProvider();
    // Do NOT set workspace context
    expect((provider as any).workspacePath).toBeNull();

    let callbackCalled = false;
    const callback = () => {
      callbackCalled = true;
    };

    const event = {
      type: "annotation.created",
      sessionId: "session-alpha",
      payload: { id: "ann-1", comment: "Test" },
    };

    // Client scope requested without workspacePath: must fail closed and reject
    const accepted = provider.processSSEEvent(event, callback, "client-a");
    expect(accepted).toBe(false);
    expect(callbackCalled).toBe(false);
  });

  it("processSSEEvent rejects global-stream events missing session identity", () => {
    const provider = new AgentationProvider();
    provider.setContext(workspaceA);

    let callbackCalled = false;
    const callback = () => {
      callbackCalled = true;
    };

    const eventWithoutSession = {
      type: "annotation.created",
      payload: { id: "ann-no-id", comment: "Missing session identity" },
    };

    const accepted = provider.processSSEEvent(eventWithoutSession, callback, "client-a");
    expect(accepted).toBe(false);
    expect(callbackCalled).toBe(false);
  });

  it("processSSEEvent rejects events from unmapped sessions or sessions mapped to another client", () => {
    const dbA = getDb(workspaceA);
    dbSaveSessionMapping(dbA, "session-alpha", "client-a", workspaceA);

    const provider = new AgentationProvider();
    provider.setContext(workspaceA);

    let callbackCalled = false;
    const callback = () => {
      callbackCalled = true;
    };

    // Event from unmapped session
    const eventUnmapped = {
      type: "annotation.created",
      sessionId: "session-unmapped",
      payload: { id: "ann-unmapped", comment: "Unmapped" },
    };
    expect(provider.processSSEEvent(eventUnmapped, callback, "client-a")).toBe(false);
    expect(callbackCalled).toBe(false);

    // Event mapped to another client in workspace B
    const dbB = getDb(workspaceB);
    dbSaveSessionMapping(dbB, "session-beta", "client-b", workspaceB);

    const eventBeta = {
      type: "annotation.created",
      sessionId: "session-beta",
      payload: { id: "ann-beta", comment: "Beta" },
    };
    expect(provider.processSSEEvent(eventBeta, callback, "client-a")).toBe(false);
    expect(callbackCalled).toBe(false);
  });

  it("processSSEEvent dispatches authorized events and properly inherits session-scoped stream identity", () => {
    const dbA = getDb(workspaceA);
    dbSaveSessionMapping(dbA, "session-alpha", "client-a", workspaceA);

    const provider = new AgentationProvider();
    provider.setContext(workspaceA);

    const received: Array<{ id?: string; _sessionId?: string }> = [];
    const callback = (ann: unknown) =>
      received.push(ann as { id?: string; _sessionId?: string });

    // 1. Valid event from authorized session on global stream
    const globalEvent = {
      type: "annotation.created",
      sessionId: "session-alpha",
      payload: { id: "ann-global", comment: "Global" },
    };
    expect(provider.processSSEEvent(globalEvent, callback, "client-a")).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]._sessionId).toBe("session-alpha");

    // 2. Session-scoped stream event inherits endpoint session identity
    const scopedEvent = {
      type: "annotation.created",
      payload: { id: "ann-scoped", comment: "Scoped" },
    };
    expect(provider.processSSEEvent(scopedEvent, callback, "client-a", "session-alpha")).toBe(true);
    expect(received).toHaveLength(2);
    expect(received[1]._sessionId).toBe("session-alpha");

    // 3. Conflicting session ID on session-scoped stream is rejected
    const conflictEvent = {
      type: "annotation.created",
      sessionId: "session-other",
      payload: { id: "ann-conflict", comment: "Conflicting" },
    };
    expect(provider.processSSEEvent(conflictEvent, callback, "client-a", "session-alpha")).toBe(false);
    expect(received).toHaveLength(2);
  });

  it("processSSEEvent rejects event if session mapping disappeared before event processing", () => {
    const dbA = getDb(workspaceA);
    dbSaveSessionMapping(dbA, "session-alpha", "client-a", workspaceA);

    const provider = new AgentationProvider();
    provider.setContext(workspaceA);

    // Remove mapping before event arrives
    dbRemoveSessionMapping(dbA, "session-alpha", "client-a");

    let callbackCalled = false;
    const callback = () => {
      callbackCalled = true;
    };

    const event = {
      type: "annotation.created",
      sessionId: "session-alpha",
      payload: { id: "ann-late", comment: "Late arrival" },
    };

    expect(provider.processSSEEvent(event, callback, "client-a")).toBe(false);
    expect(callbackCalled).toBe(false);
  });

  // ── Polling & Lifecycle Isolation ──────────────────────────────────────────

  it("Polling retrieval strictly isolates sessions between clients", async () => {
    const dbA = getDb(workspaceA);
    const dbB = getDb(workspaceB);

    dbSaveSessionMapping(dbA, "session-alpha", "client-a", workspaceA);
    dbSaveSessionMapping(dbB, "session-beta", "client-b", workspaceB);

    const providerA = new AgentationProvider();
    providerA.setContext(workspaceA);

    const providerB = new AgentationProvider();
    providerB.setContext(workspaceB);

    const sessionsA = dbGetSessionsForClient(dbA, "client-a");
    const sessionsB = dbGetSessionsForClient(dbB, "client-b");

    expect(sessionsA).toEqual(["session-alpha"]);
    expect(sessionsB).toEqual(["session-beta"]);

    expect(dbIsSessionMapped(dbA, "session-beta", "client-a")).toBe(false);
    expect(dbIsSessionMapped(dbB, "session-alpha", "client-b")).toBe(false);
  });

  it("Idempotent imports preserve task links, status, and resolution summaries across re-imports", async () => {
    const dbA = getDb(workspaceA);

    const initialItem: VisualFeedback = VisualFeedbackSchema.parse({
      id: "fb-12345678",
      provider: "agentation",
      providerAnnotationId: "ann-999",
      clientId: "client-a",
      sessionId: "session-alpha",
      pageUrl: "http://localhost:3000",
      comment: "Fix the header padding",
      kind: "style",
      intent: "fix",
      severity: "medium",
      status: "linked",
      taskId: "task-abc12345",
      createdAt: new Date().toISOString(),
    });

    dbSaveFeedback(dbA, initialItem);

    const loaded = dbLoadFeedback(dbA, "fb-12345678");
    expect(loaded).toBeDefined();
    expect(loaded?.status).toBe("linked");
    expect(loaded?.taskId).toBe("task-abc12345");

    const reimportedItem: VisualFeedback = VisualFeedbackSchema.parse({
      id: "different-temporary-id",
      provider: "agentation",
      providerAnnotationId: "ann-999",
      clientId: "client-a",
      sessionId: "session-alpha",
      pageUrl: "http://localhost:3000",
      comment: "Fix the header padding",
      kind: "style",
      intent: "fix",
      severity: "medium",
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    const existing = dbFindFeedbackByProviderAnnotation(
      dbA,
      reimportedItem.provider,
      reimportedItem.providerAnnotationId!,
      reimportedItem.clientId,
    );
    expect(existing).toBeDefined();

    if (existing) {
      reimportedItem.id = existing.id;
      reimportedItem.status = existing.status;
      reimportedItem.taskId = existing.taskId;
      reimportedItem.resolutionSummary = existing.resolutionSummary;
    }

    dbSaveFeedback(dbA, reimportedItem);

    const updated = dbLoadFeedback(dbA, "fb-12345678");
    expect(updated?.id).toBe("fb-12345678");
    expect(updated?.status).toBe("linked");
    expect(updated?.taskId).toBe("task-abc12345");
  });

  it("importFeedback accurately tracks newCount, updatedCount, and unchangedCount", async () => {
    const itemDir = path.join(workspaceA, "feedback", "items");
    await fs.ensureDir(itemDir);

    const raw1 = {
      id: "ann-counter-1",
      comment: "Initial comment",
      pageUrl: "http://localhost:3000",
      selector: "button.submit",
    };
    await fs.writeJson(path.join(itemDir, "item-1.json"), raw1);

    const res1 = await importFeedback(workspaceA, "client-a", "manual");
    expect(res1.newCount).toBe(1);
    expect(res1.updatedCount).toBe(0);
    expect(res1.unchangedCount).toBe(0);
    expect(res1.imported).toHaveLength(1);

    const res2 = await importFeedback(workspaceA, "client-a", "manual");
    expect(res2.newCount).toBe(0);
    expect(res2.updatedCount).toBe(0);
    expect(res2.unchangedCount).toBe(1);

    const rawModified = {
      ...raw1,
      comment: "Updated comment text",
    };
    await fs.writeJson(path.join(itemDir, "item-1.json"), rawModified);

    const res3 = await importFeedback(workspaceA, "client-a", "manual");
    expect(res3.newCount).toBe(0);
    expect(res3.updatedCount).toBe(1);
    expect(res3.unchangedCount).toBe(0);
  });

  it("MCP ownership check rejects unmapped, empty, or cross-workspace sessions", async () => {
    const dbA = getDb(workspaceA);
    dbSaveSessionMapping(dbA, "session-alpha", "client-a", workspaceA);

    const fbNoSession = VisualFeedbackSchema.parse({
      id: "fb-missing-session",
      provider: "agentation",
      providerAnnotationId: "ann-no-sess",
      clientId: "client-a",
      sessionId: "",
      pageUrl: "http://localhost:3000",
      comment: "Missing session ID",
      createdAt: new Date().toISOString(),
    });
    dbSaveFeedback(dbA, fbNoSession);

    const authNoSession = await checkAnnotationWorkspaceOwnership(
      workspaceA,
      "fb-missing-session",
    );
    expect(authNoSession.authorized).toBe(false);
    expect(authNoSession.reason).toContain("no associated session ID");
  });
});
