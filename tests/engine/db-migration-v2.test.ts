import { describe, it, expect, beforeEach } from "vitest";
import {
  getTestDb,
  dbSaveFeedback,
  dbLoadFeedback,
  dbFindFeedbackByProviderAnnotation,
  dbSaveSessionMapping,
  dbGetSessionsForClient,
  dbIsSessionMapped,
} from "../../src/engine/db.js";
import type { VisualFeedback } from "../../src/visual-feedback/schema.js";
import { VisualFeedbackSchema } from "../../src/visual-feedback/schema.js";
import crypto from "crypto";
import type Database from "better-sqlite3";

function makeFeedback(overrides: Partial<VisualFeedback> = {}): VisualFeedback {
  return VisualFeedbackSchema.parse({
    id: crypto.randomBytes(8).toString("hex"),
    provider: "agentation",
    providerAnnotationId: "ann_" + crypto.randomBytes(4).toString("hex"),
    clientId: "test-client",
    pageUrl: "https://example.com",
    comment: "Test feedback",
    createdAt: new Date().toISOString(),
    ...overrides,
  });
}

describe("DB migration v2", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = getTestDb();
  });

  it("migration runs cleanly on fresh database", () => {
    // getTestDb already runs all migrations
    const rows = db
      .prepare("SELECT version FROM _migrations ORDER BY version")
      .all() as Array<{ version: number }>;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.some((r) => r.version === 2)).toBe(true);
  });

  it("provider_metadata column exists after migration", () => {
    const info = db
      .prepare("PRAGMA table_info(feedback_items)")
      .all() as Array<{ name: string }>;
    expect(info.some((c) => c.name === "provider_metadata")).toBe(true);
  });

  it("session_mappings table exists after migration", () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='session_mappings'",
      )
      .all();
    expect(tables.length).toBe(1);
  });
});

describe("dbFindFeedbackByProviderAnnotation", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = getTestDb();
  });

  it("finds feedback by provider triple", () => {
    const fb = makeFeedback({
      providerAnnotationId: "ann_123",
      clientId: "client-a",
    });
    dbSaveFeedback(db, fb);
    const found = dbFindFeedbackByProviderAnnotation(
      db,
      "agentation",
      "ann_123",
      "client-a",
    );
    expect(found).not.toBeNull();
    expect(found!.id).toBe(fb.id);
  });

  it("returns null for different client", () => {
    const fb = makeFeedback({
      providerAnnotationId: "ann_123",
      clientId: "client-a",
    });
    dbSaveFeedback(db, fb);
    const found = dbFindFeedbackByProviderAnnotation(
      db,
      "agentation",
      "ann_123",
      "client-b",
    );
    expect(found).toBeNull();
  });

  it("returns null for unknown annotation", () => {
    const found = dbFindFeedbackByProviderAnnotation(
      db,
      "agentation",
      "nonexistent",
      "client-a",
    );
    expect(found).toBeNull();
  });
});

describe("upsert preserves task links", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = getTestDb();
  });

  it("preserves task_id and status on re-import", () => {
    const fb = makeFeedback({ id: "stable-id", comment: "original comment" });
    dbSaveFeedback(db, fb);

    // Simulate linking to a task
    db.prepare(
      "UPDATE feedback_items SET task_id = ?, status = ? WHERE id = ?",
    ).run("task-abc", "linked", "stable-id");

    // Re-import with updated content (same id)
    const updated = makeFeedback({
      id: "stable-id",
      comment: "updated comment",
    });
    dbSaveFeedback(db, updated);

    const loaded = dbLoadFeedback(db, "stable-id");
    expect(loaded).not.toBeNull();
    expect(loaded!.comment).toBe("updated comment"); // content updated
    expect(loaded!.taskId).toBe("task-abc"); // task link preserved
    expect(loaded!.status).toBe("linked"); // status preserved
  });

  it("preserves resolution_summary on re-import", () => {
    const fb = makeFeedback({ id: "resolved-id" });
    dbSaveFeedback(db, fb);

    db.prepare(
      "UPDATE feedback_items SET status = ?, resolution_summary = ? WHERE id = ?",
    ).run("resolved", "Fixed the alignment", "resolved-id");

    const updated = makeFeedback({ id: "resolved-id", comment: "new comment" });
    dbSaveFeedback(db, updated);

    const loaded = dbLoadFeedback(db, "resolved-id");
    expect(loaded!.status).toBe("resolved");
    expect(loaded!.resolutionSummary).toBe("Fixed the alignment");
  });
});

describe("providerMetadata round-trip", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = getTestDb();
  });

  it("stores and retrieves providerMetadata", () => {
    const metadata = {
      placement: { component: "Button", width: 200, height: 40 },
      selectedText: "Click here",
    };
    const fb = makeFeedback({ providerMetadata: metadata });
    dbSaveFeedback(db, fb);

    const loaded = dbLoadFeedback(db, fb.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.providerMetadata).toEqual(metadata);
  });

  it("handles null providerMetadata", () => {
    const fb = makeFeedback({});
    dbSaveFeedback(db, fb);
    const loaded = dbLoadFeedback(db, fb.id);
    expect(loaded!.providerMetadata).toBeUndefined();
  });
});

describe("session mappings", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = getTestDb();
  });

  it("saves and retrieves session mappings", () => {
    dbSaveSessionMapping(db, "sess_1", "client-a", "/workspace/a");
    dbSaveSessionMapping(db, "sess_2", "client-a", "/workspace/a");
    dbSaveSessionMapping(db, "sess_3", "client-b", "/workspace/b");

    const clientASessions = dbGetSessionsForClient(db, "client-a");
    expect(clientASessions).toHaveLength(2);
    expect(clientASessions).toContain("sess_1");
    expect(clientASessions).toContain("sess_2");

    const clientBSessions = dbGetSessionsForClient(db, "client-b");
    expect(clientBSessions).toHaveLength(1);
    expect(clientBSessions).toContain("sess_3");
  });

  it("checks if session is mapped", () => {
    dbSaveSessionMapping(db, "sess_1", "client-a", "/workspace/a");
    expect(dbIsSessionMapped(db, "sess_1", "client-a")).toBe(true);
    expect(dbIsSessionMapped(db, "sess_1", "client-b")).toBe(false);
    expect(dbIsSessionMapped(db, "sess_unknown", "client-a")).toBe(false);
  });

  it("returns empty array for unmapped client", () => {
    const sessions = dbGetSessionsForClient(db, "nonexistent");
    expect(sessions).toEqual([]);
  });
});
