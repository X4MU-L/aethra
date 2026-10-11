/**
 * Tests for the integration metadata loader.
 * Covers schema validation (pure), filesystem-based loading, and status helpers.
 */

import { describe, it, expect } from "vitest";
import path from "path";
import { IntegrationMetadataSchema } from "../../src/core/schemas.js";
import {
  loadAllIntegrations,
  loadIntegration,
  getIntegrationStatus,
} from "../../src/integrations/loader.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Minimal valid metadata matching anatomy's structure (with classification). */
const anatomyLike = {
  source: {
    name: "anatomy",
    upstream_url: "https://github.com/wheresryan22/anatomy",
    repository_url: "https://github.com/wheresryan22/anatomy",
    author: "wheresryan22",
    license: "MIT",
    version: "1.0.0",
    pinned_ref: "main",
  },
  import: {
    date: "2026-10-11",
    imported_by: "Aethra Workbench",
    purpose: "Illustration capability for technical diagrams.",
  },
  attribution: {
    required: true,
    notice: "Adapted from anatomy, licensed under MIT.",
  },
  classification: {
    status: "planned",
    integration_type: "optional-capability",
    notes: "Optional integration.",
  },
};

/** Minimal valid metadata matching pstack's structure (no classification). */
const pstackLike = {
  source: {
    name: "pstack",
    upstream_url: "https://github.com/cursor/plugins/tree/main/pstack",
    repository_url: "https://github.com/cursor/plugins",
    subdirectory: "pstack",
    author: "Lauren Tan (poteto)",
    license: "MIT",
    version: "0.15.15",
    pinned_ref: "main",
  },
  import: {
    date: "2026-10-10",
    imported_by: "Aethra Workbench (automated inventory)",
    purpose: "Adopt engineering principles for delivery quality.",
  },
  attribution: {
    required: true,
    notice: "Adapted from pstack by Lauren Tan, licensed under MIT.",
  },
};

// ─── Schema validation (pure, no filesystem) ────────────────────────────────

describe("IntegrationMetadataSchema", () => {
  it("validates anatomy-like structure with classification", () => {
    const result = IntegrationMetadataSchema.safeParse(anatomyLike);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source.name).toBe("anatomy");
      expect(result.data.classification?.status).toBe("planned");
    }
  });

  it("validates pstack-like structure without classification", () => {
    const result = IntegrationMetadataSchema.safeParse(pstackLike);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source.name).toBe("pstack");
      expect(result.data.classification).toBeUndefined();
    }
  });

  it("rejects missing source.name", () => {
    const invalid = structuredClone(anatomyLike);
    // @ts-expect-error — deliberately removing required field
    delete invalid.source.name;
    const result = IntegrationMetadataSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects invalid upstream URL", () => {
    const invalid = structuredClone(anatomyLike);
    invalid.source.upstream_url = "not-a-url";
    const result = IntegrationMetadataSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("accepts all IntegrationStatus values", () => {
    const statuses = [
      "implemented",
      "planned",
      "deprecated",
      "experimental",
    ] as const;
    for (const status of statuses) {
      const obj = structuredClone(anatomyLike);
      obj.classification.status = status;
      const result = IntegrationMetadataSchema.safeParse(obj);
      expect(result.success, `expected status "${status}" to be valid`).toBe(
        true,
      );
    }
  });
});

// ─── loadAllIntegrations (real project files) ────────────────────────────────

describe("loadAllIntegrations", () => {
  const integrationsDir = path.resolve(__dirname, "../../integrations");

  it("loads both integrations from the project", async () => {
    const result = await loadAllIntegrations(integrationsDir);
    expect(result.integrations).toHaveLength(2);
    const names = result.integrations.map((i) => i.name).sort();
    expect(names).toEqual(["anatomy", "pstack"]);
  });

  it("returns correct statuses for each integration", async () => {
    const result = await loadAllIntegrations(integrationsDir);
    const anatomy = result.integrations.find((i) => i.name === "anatomy");
    const pstack = result.integrations.find((i) => i.name === "pstack");
    expect(anatomy?.status).toBe("planned");
    expect(pstack?.status).toBe("implemented");
  });

  it("returns empty for nonexistent directory", async () => {
    const result = await loadAllIntegrations("/nonexistent/path");
    expect(result.integrations).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});

// ─── loadIntegration ─────────────────────────────────────────────────────────

describe("loadIntegration", () => {
  it("loads a single integration by directory path", async () => {
    const anatomyDir = path.resolve(__dirname, "../../integrations/anatomy");
    const loaded = await loadIntegration(anatomyDir);
    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBe("anatomy");
    expect(loaded?.status).toBe("planned");
    expect(loaded?.metadata.source.upstream_url).toBe(
      "https://github.com/wheresryan22/anatomy",
    );
  });
});

// ─── getIntegrationStatus ────────────────────────────────────────────────────

describe("getIntegrationStatus", () => {
  it("returns correct status for a known integration", async () => {
    const integrationsDir = path.resolve(__dirname, "../../integrations");
    const result = await loadAllIntegrations(integrationsDir);
    expect(getIntegrationStatus("anatomy", result)).toBe("planned");
  });

  it("returns undefined for an unknown integration", async () => {
    const integrationsDir = path.resolve(__dirname, "../../integrations");
    const result = await loadAllIntegrations(integrationsDir);
    expect(getIntegrationStatus("unknown", result)).toBeUndefined();
  });
});
