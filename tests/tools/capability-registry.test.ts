/**
 * Tests for the capability registry (src/tools/capability-registry.ts).
 */

import { describe, it, expect, vi } from "vitest";
import {
  listCapabilities,
  getCapability,
  getCapabilitiesForTask,
  getCapabilitiesForStage,
  checkCapabilityAvailability,
} from "../../src/tools/capability-registry.js";
import type { WorkflowStage } from "../../src/core/schemas.js";

// ─── listCapabilities ────────────────────────────────────────────────────────

describe("listCapabilities", () => {
  it("returns all 8 registered capabilities", () => {
    expect(listCapabilities()).toHaveLength(8);
  });

  it("each entry has required fields (id, name, category, description)", () => {
    for (const cap of listCapabilities()) {
      expect(cap).toHaveProperty("id");
      expect(cap).toHaveProperty("name");
      expect(cap).toHaveProperty("category");
      expect(cap).toHaveProperty("description");
    }
  });
});

// ─── getCapability ───────────────────────────────────────────────────────────

describe("getCapability", () => {
  it("returns capability for known id 'browser-screenshot'", () => {
    const cap = getCapability("browser-screenshot");
    expect(cap).toBeDefined();
    expect(cap!.id).toBe("browser-screenshot");
  });

  it("returns undefined for unknown id 'nonexistent'", () => {
    expect(getCapability("nonexistent")).toBeUndefined();
  });
});

// ─── getCapabilitiesForTask ──────────────────────────────────────────────────

describe("getCapabilitiesForTask", () => {
  it("returns capabilities for 'direct-fix' including browser-screenshot and lighthouse-audit", () => {
    const caps = getCapabilitiesForTask("direct-fix");
    const ids = caps.map((c) => c.id);
    expect(ids).toContain("browser-screenshot");
    expect(ids).toContain("lighthouse-audit");
  });

  it("returns capabilities for 'design-exploration' including visual-critique and design-direction-planning", () => {
    const caps = getCapabilitiesForTask("design-exploration");
    const ids = caps.map((c) => c.id);
    expect(ids).toContain("visual-critique");
    expect(ids).toContain("design-direction-planning");
  });

  it("filters by platform — wordpress excludes visual-annotation (react/nextjs only)", () => {
    const caps = getCapabilitiesForTask("direct-fix", "wordpress");
    const ids = caps.map((c) => c.id);
    expect(ids).not.toContain("visual-annotation");
  });

  it("platform filtering does not affect capabilities without supportedPlatforms", () => {
    const caps = getCapabilitiesForTask("direct-fix", "wordpress");
    const ids = caps.map((c) => c.id);
    // browser-screenshot has no supportedPlatforms, so it should still appear
    expect(ids).toContain("browser-screenshot");
  });
});

// ─── getCapabilitiesForStage ─────────────────────────────────────────────────

describe("getCapabilitiesForStage", () => {
  it("returns capabilities for 'investigate' stage", () => {
    const stage: WorkflowStage = "investigate";
    const caps = getCapabilitiesForStage(stage);
    const ids = caps.map((c) => c.id);
    expect(ids).toContain("browser-screenshot");
    expect(ids).toContain("lighthouse-audit");
    expect(caps.length).toBeGreaterThan(0);
  });

  it("returns capabilities for 'verify' stage", () => {
    const stage: WorkflowStage = "verify";
    const caps = getCapabilitiesForStage(stage);
    const ids = caps.map((c) => c.id);
    expect(ids).toContain("visual-critique");
    expect(ids).toContain("test-runner");
    expect(caps.length).toBeGreaterThan(0);
  });

  it("returns capabilities for 'plan' stage", () => {
    const stage: WorkflowStage = "plan";
    const caps = getCapabilitiesForStage(stage);
    const ids = caps.map((c) => c.id);
    expect(ids).toContain("design-direction-planning");
    expect(ids).toContain("code-analysis");
    expect(caps.length).toBeGreaterThan(0);
  });
});

// ─── checkCapabilityAvailability ─────────────────────────────────────────────

describe("checkCapabilityAvailability", () => {
  it("returns unavailable with message for unknown id", async () => {
    const result = await checkCapabilityAvailability("nonexistent");
    expect(result.status).toBe("unavailable");
    expect(result.message).toBeDefined();
  });

  it("returns available for 'code-analysis' (no deps, always available)", async () => {
    const result = await checkCapabilityAvailability("code-analysis");
    expect(result.status).toBe("available");
  });

  it("returns 'requires-setup' for visual-annotation when Agentation server is not running", async () => {
    const { getProvider } = await import(
      "../../src/visual-feedback/providers/registry.js"
    );
    const provider = getProvider("agentation")!;
    const spy = vi.spyOn(provider, "checkAvailability").mockResolvedValueOnce({
      available: true,
      connected: false,
      version: null,
      error: "Agentation server not running",
      capabilities: provider.reportCapabilities(),
    });
    try {
      const result = await checkCapabilityAvailability("visual-annotation");
      expect(result.status).toBe("requires-setup");
      expect(result.message).toContain("Agentation server not running");
    } finally {
      spy.mockRestore();
    }
  });

  it("returns 'available' for visual-annotation when Agentation server is operational", async () => {
    const { getProvider } = await import(
      "../../src/visual-feedback/providers/registry.js"
    );
    const provider = getProvider("agentation")!;
    const spy = vi.spyOn(provider, "checkAvailability").mockResolvedValueOnce({
      available: true,
      connected: true,
      version: null,
      error: null,
      capabilities: provider.reportCapabilities(),
    });
    try {
      const result = await checkCapabilityAvailability("visual-annotation");
      expect(result.status).toBe("available");
    } finally {
      spy.mockRestore();
    }
  });
});

// ─── visual-critique status ──────────────────────────────────────────────────

describe("visual-critique status", () => {
  it("has status 'degraded' (stub implementation)", () => {
    expect(getCapability("visual-critique")?.status).toBe("degraded");
  });
});
