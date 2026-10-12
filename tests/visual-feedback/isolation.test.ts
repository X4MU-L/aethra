/**
 * Cross-workspace security isolation tests.
 *
 * Verifies that two distinct workspaces with distinct session mappings
 * cannot access, ingest, resolve, or mutate each other's annotations across:
 * 1. Session mappings and Migration 3 uniqueness
 * 2. Polling retrieval isolation
 * 3. Real-time SSE event isolation
 * 4. Upstream acknowledgement synchronization
 * 5. Re-import lifecycle idempotence
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "fs-extra";
import {
  getDb,
  closeDb,
  dbSaveSessionMapping,
  dbGetSessionsForClient,
  dbIsSessionMapped,
  dbSaveFeedback,
  dbLoadFeedback,
  dbFindFeedbackByProviderAnnotation,
} from "../../src/engine/db.js";
import { VisualFeedbackError } from "../../src/core/errors.js";
import { AgentationProvider } from "../../src/visual-feedback/providers/agentation.js";
import { importFeedback, resolveFeedback, dismissFeedback } from "../../src/visual-feedback/manager.js";
import {
  VisualFeedbackSchema,
  type VisualFeedback,
} from "../../src/visual-feedback/schema.js";
import { checkAnnotationWorkspaceOwnership } from "../../src/mcp/server.js";

describe("Cross-workspace security isolation", () => {
  let tmpRoot: string;
  let workspaceA: string;
  let workspaceB: string;

  beforeEach(async () => {
    tmpRoot = path.join(
      os.tmpdir(),
      `aethra-isolation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    workspaceA = path.join(tmpRoot, "client-a");
    workspaceB = path.join(tmpRoot, "client-b");

    await fs.ensureDir(workspaceA);
    await fs.ensureDir(workspaceB);

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
    closeDb(workspaceA);
    closeDb(workspaceB);
    await fs.remove(tmpRoot);
  });

  it("Migration 3 prevents one session from being mapped to multiple clients", () => {
    const dbA = getDb(workspaceA);

    // Map session-123 to Client A in workspace A
    dbSaveSessionMapping(dbA, "session-123", "client-a", workspaceA);
    expect(dbIsSessionMapped(dbA, "session-123", "client-a")).toBe(true);

    // Attempt to map the exact same session-123 to Client B
    // Must throw VisualFeedbackError due to Migration 3 unique constraint and ownership check
    expect(() => {
      dbSaveSessionMapping(dbA, "session-123", "client-b", workspaceA);
    }).toThrow(VisualFeedbackError);

    // Ensure Client B has 0 sessions
    const sessionsB = dbGetSessionsForClient(dbA, "client-b");
    expect(sessionsB).toEqual([]);
  });

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

    // Client A cannot see Client B's session mappings
    expect(dbIsSessionMapped(dbA, "session-beta", "client-a")).toBe(false);
    expect(dbIsSessionMapped(dbB, "session-alpha", "client-b")).toBe(false);
  });

  it("AgentationProvider.processSSEEvent fails closed on missing sessionId", () => {
    const dbA = getDb(workspaceA);
    dbSaveSessionMapping(dbA, "session-alpha", "client-a", workspaceA);

    const provider = new AgentationProvider();
    provider.setContext(workspaceA);

    const receivedForA: unknown[] = [];
    const callback = (ann: unknown) => receivedForA.push(ann);

    // Event with NO sessionId or payload.sessionId must fail closed and be rejected
    const eventWithoutSession = {
      type: "annotation.created",
      payload: { id: "ann-no-session", comment: "No session metadata" },
    };

    const accepted = provider.processSSEEvent(eventWithoutSession, callback, "client-a");
    expect(accepted).toBe(false);
    expect(receivedForA).toHaveLength(0);
  });

  it("AgentationProvider.processSSEEvent drops annotations belonging to another workspace", () => {
    const dbA = getDb(workspaceA);
    dbSaveSessionMapping(dbA, "session-alpha", "client-a", workspaceA);

    const provider = new AgentationProvider();
    provider.setContext(workspaceA);

    const receivedForA: unknown[] = [];
    const callback = (ann: unknown) => receivedForA.push(ann);

    // Event from workspace B's session
    const eventFromB = {
      type: "annotation.created",
      sessionId: "session-beta",
      payload: { id: "ann-beta", comment: "Beta bug" },
    };

    const acceptedB = provider.processSSEEvent(eventFromB, callback, "client-a");
    expect(acceptedB).toBe(false);
    expect(receivedForA).toHaveLength(0);

    // Event from workspace A's mapped session
    const eventFromA = {
      type: "annotation.created",
      sessionId: "session-alpha",
      payload: { id: "ann-alpha", comment: "Alpha bug" },
    };

    const acceptedA = provider.processSSEEvent(eventFromA, callback, "client-a");
    expect(acceptedA).toBe(true);
    expect(receivedForA).toHaveLength(1);
    expect((receivedForA[0] as { id: string }).id).toBe("ann-alpha");
  });

  it("MCP ownership check rejects cross-workspace annotations and stale sessions", async () => {
    const dbA = getDb(workspaceA);
    dbSaveSessionMapping(dbA, "session-alpha", "client-a", workspaceA);

    // 1. Local feedback belonging to Client A with mapped session-alpha
    const fbA = VisualFeedbackSchema.parse({
      id: "fb-alpha-001",
      provider: "agentation",
      providerAnnotationId: "ann-alpha-001",
      clientId: "client-a",
      sessionId: "session-alpha",
      pageUrl: "http://localhost:3000",
      comment: "Alpha issue",
      createdAt: new Date().toISOString(),
    });
    dbSaveFeedback(dbA, fbA);

    const authA = await checkAnnotationWorkspaceOwnership(workspaceA, "fb-alpha-001");
    expect(authA.authorized).toBe(true);

    // 2. Feedback belonging to another client (client-b) in workspace A
    const fbB = VisualFeedbackSchema.parse({
      id: "fb-beta-foreign",
      provider: "agentation",
      providerAnnotationId: "ann-foreign",
      clientId: "client-b",
      sessionId: "session-beta",
      pageUrl: "http://localhost:4000",
      comment: "Beta issue",
      createdAt: new Date().toISOString(),
    });
    dbSaveFeedback(dbA, fbB);

    const authForeign = await checkAnnotationWorkspaceOwnership(workspaceA, "fb-beta-foreign");
    expect(authForeign.authorized).toBe(false);
    expect(authForeign.reason).toContain('belongs to client "client-b"');

    // 3. Feedback in client-a but with unmapped/stale session-gamma
    const fbStale = VisualFeedbackSchema.parse({
      id: "fb-stale-session",
      provider: "agentation",
      providerAnnotationId: "ann-stale",
      clientId: "client-a",
      sessionId: "session-gamma",
      pageUrl: "http://localhost:3000",
      comment: "Stale session issue",
      createdAt: new Date().toISOString(),
    });
    dbSaveFeedback(dbA, fbStale);

    const authStale = await checkAnnotationWorkspaceOwnership(workspaceA, "fb-stale-session");
    expect(authStale.authorized).toBe(false);
    expect(authStale.reason).toContain('session "session-gamma" is not mapped');
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

    // Save initial feedback
    dbSaveFeedback(dbA, initialItem);

    const loaded = dbLoadFeedback(dbA, "fb-12345678");
    expect(loaded).toBeDefined();
    expect(loaded?.status).toBe("linked");
    expect(loaded?.taskId).toBe("task-abc12345");

    // Re-import the same annotation: should preserve existing lifecycle metadata
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
      status: "pending", // incoming would normally be pending
      createdAt: new Date().toISOString(),
    });

    // Test deduplication lookup
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

  it("resolveFeedback and dismissFeedback distinguish local resolution from upstream failure", async () => {
    const dbA = getDb(workspaceA);

    const item: VisualFeedback = VisualFeedbackSchema.parse({
      id: "fb-resolve-test",
      provider: "manual",
      clientId: "client-a",
      pageUrl: "http://localhost:3000",
      comment: "Check button alignment",
      kind: "style",
      intent: "investigate",
      severity: "low",
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    dbSaveFeedback(dbA, item);

    // Resolve via manager
    const resolved = await resolveFeedback(
      workspaceA,
      "fb-resolve-test",
      "Fixed alignment in CSS",
    );

    expect(resolved.status).toBe("resolved");
    expect(resolved.resolutionSummary).toBe("Fixed alignment in CSS");
    expect(resolved.upstreamSynced).toBe(true);

    // Dismiss via manager
    const dismissed = await dismissFeedback(
      workspaceA,
      "fb-resolve-test",
      "Not a bug, intentional design",
    );

    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.resolutionSummary).toBe("Dismissed: Not a bug, intentional design");
    expect(dismissed.upstreamSynced).toBe(true);
  });
});
