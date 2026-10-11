/**
 * End-to-end test: full visual feedback lifecycle.
 *
 * Uses a mock provider to simulate annotation import, deduplication,
 * plan creation from feedback, task linking, and resolution.
 *
 * Proves:
 *   1. Feedback can be imported from a provider and persisted.
 *   2. Pending feedback is listable by status.
 *   3. A plan + task can be created from feedback items.
 *   4. Feedback items are linked to the created task.
 *   5. Feedback can be resolved with a summary.
 *   6. Re-import deduplicates by providerAnnotationId.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import path from "path";
import os from "os";

import { closeDb } from "../../src/engine/db.js";
import { registerProvider } from "../../src/visual-feedback/providers/registry.js";
import {
  importFeedback,
  listFeedback,
  createPlanFromFeedback,
  resolveFeedback,
  loadFeedback,
} from "../../src/visual-feedback/manager.js";
import { VisualFeedbackProvider } from "../../src/visual-feedback/providers/base.js";
import type {
  RawAnnotation,
  ProviderStatus,
  ProviderCapabilities,
} from "../../src/visual-feedback/providers/base.js";
import { VisualFeedbackSchema } from "../../src/visual-feedback/schema.js";
import type { VisualFeedback } from "../../src/visual-feedback/schema.js";
import type { PlatformType, ClientConfig } from "../../src/core/schemas.js";
import type { TaskRecord, ImplementationPlan } from "../../src/core/schemas.js";

// ─── Mock provider ──────────────────────────────────────────────────────────

class MockProvider extends VisualFeedbackProvider {
  readonly name = "mock";
  acknowledgedIds: string[] = [];

  async checkAvailability(): Promise<ProviderStatus> {
    return {
      available: true,
      connected: true,
      version: "1.0",
      error: null,
      capabilities: this.reportCapabilities(),
    };
  }

  async detectCompatibility(
    _platform: PlatformType,
    _config: ClientConfig,
  ): Promise<{ compatible: boolean; reason: string }> {
    return { compatible: true, reason: "Mock provider" };
  }

  async startSession(_opts: {
    pageUrl: string;
    clientSlug: string;
    sessionId: string;
  }): Promise<{ success: boolean; sessionUrl?: string }> {
    return { success: true, sessionUrl: "http://localhost:3000" };
  }

  async retrievePending(_clientSlug: string): Promise<RawAnnotation[]> {
    return [
      {
        id: "mock-ann-1",
        pageUrl: "http://localhost:3000/home",
        comment: "Button alignment is off",
        kind: "style",
        severity: "medium",
        element: "button",
        elementPath: "div > button.cta",
      },
      {
        id: "mock-ann-2",
        pageUrl: "http://localhost:3000/about",
        comment: "Missing alt text on hero image",
        kind: "accessibility",
        severity: "high",
        element: "img",
        elementPath: "section > img.hero",
      },
    ];
  }

  normalize(raw: RawAnnotation, clientSlug: string): VisualFeedback {
    return VisualFeedbackSchema.parse({
      id: `mock-${raw.id}-${clientSlug}`,
      provider: "mock",
      providerAnnotationId: raw.id as string,
      clientId: clientSlug,
      pageUrl: raw.pageUrl as string,
      comment: raw.comment as string,
      kind: (raw.kind as string) ?? "other",
      severity: (raw.severity as string) ?? "medium",
      intent: "fix",
      elementSelector: raw.elementPath as string,
      elementTag: raw.element as string,
      createdAt: new Date().toISOString(),
      status: "pending",
    });
  }

  async acknowledge(
    annotationId: string,
    _resolution?: { status: string; summary: string },
  ): Promise<void> {
    this.acknowledgedIds.push(annotationId);
  }

  reportCapabilities(): ProviderCapabilities {
    return {
      canStartSession: true,
      canAcknowledge: true,
      canResolve: true,
      supportsRealtime: false,
      supportedPlatforms: ["react" as PlatformType],
      requiresToolbarInstall: false,
    };
  }
}

// ─── Shared state ────────────────────────────────────────────────────────────

let tmpWorkspace: string;
let importedItems: VisualFeedback[];
let taskRecord: TaskRecord;

beforeAll(() => {
  tmpWorkspace = mkdtempSync(path.join(os.tmpdir(), "aethra-e2e-feedback-"));
  mkdirSync(path.join(tmpWorkspace, ".local"), { recursive: true });
  mkdirSync(path.join(tmpWorkspace, "plans"), { recursive: true });

  const mockProvider = new MockProvider();
  registerProvider(mockProvider);
});

afterAll(() => {
  closeDb(tmpWorkspace);
  rmSync(tmpWorkspace, { recursive: true, force: true });
});

// ─── Full feedback lifecycle ─────────────────────────────────────────────────

describe("feedback lifecycle — full workflow", () => {
  it("step 1: import feedback from mock provider", async () => {
    const result = await importFeedback(tmpWorkspace, "test-client", "mock");

    expect(result.imported.length).toBe(2);
    expect(result.errors.length).toBe(0);

    for (const item of result.imported) {
      expect(item.status).toBe("pending");
    }

    importedItems = result.imported;
  });

  it("step 2: list pending feedback", async () => {
    const pending = await listFeedback(tmpWorkspace, { status: "pending" });

    expect(pending.length).toBe(2);
  });

  it("step 3: create plan from feedback", async () => {
    const result = await createPlanFromFeedback(
      tmpWorkspace,
      importedItems,
      "test-client",
    );

    expect(result.plan.status).toBe("draft");
    expect(result.plan.feedbackIds).toHaveLength(2);
    expect(result.taskRecord.status).toBe("planned");

    taskRecord = result.taskRecord;
  });

  it("step 4: verify feedback linked to task", async () => {
    for (const item of importedItems) {
      const reloaded = await loadFeedback(tmpWorkspace, item.id);

      expect(reloaded).not.toBeNull();
      expect(reloaded!.status).toBe("linked");
      expect(reloaded!.taskId).toBe(taskRecord.id);
    }
  });

  it("step 5: resolve feedback", async () => {
    const resolved = await resolveFeedback(
      tmpWorkspace,
      importedItems[0]!.id,
      "Fixed alignment",
    );

    expect(resolved.status).toBe("resolved");
    expect(resolved.resolutionSummary).toBe("Fixed alignment");

    // Reload to confirm persistence
    const reloaded = await loadFeedback(tmpWorkspace, importedItems[0]!.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.status).toBe("resolved");
    expect(reloaded!.resolutionSummary).toBe("Fixed alignment");
  });

  it("step 6: dedup on re-import", async () => {
    const result = await importFeedback(tmpWorkspace, "test-client", "mock");

    // The mock returns the same providerAnnotationIds, so they should be
    // deduplicated — no new records created.
    expect(result.imported.length).toBe(2);
    expect(result.errors.length).toBe(0);

    const all = await listFeedback(tmpWorkspace);
    expect(all.length).toBe(2);
  });
});
