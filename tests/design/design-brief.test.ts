/**
 * Tests for the design brief module.
 */

import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  createDesignBrief,
  saveDesignBrief,
  loadDesignBrief,
} from "../../src/design/design-brief.js";
import type { DesignDirection } from "../../src/core/schemas.js";

// ─── Helper ────────────────────────────────────────────────────────────────

function makeDirection(
  axisOverrides: Record<string, string> = {},
): DesignDirection {
  const defaults: Record<string, string> = {
    "layout-density": "balanced-standard",
    "typography-character": "geometric-modern",
    "color-temperature": "cool-professional",
    "hierarchy-strategy": "hero-dominant",
    "interaction-weight": "subtle-transitions",
    "imagery-role": "photography-led",
  };
  const merged = { ...defaults, ...axisOverrides };
  return {
    id: "dir-test-001",
    name: "Test Direction",
    axes: Object.entries(merged).map(([axis, position]) => ({
      axis,
      position,
      description: `Test ${position}`,
    })),
    rationale: "Test direction rationale",
  };
}

// ─── Temp dir for save/load tests ──────────────────────────────────────────

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aethra-brief-test-"));

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── createDesignBrief tests ───────────────────────────────────────────────

describe("createDesignBrief", () => {
  it("returns a valid structure with all required fields present", () => {
    const brief = createDesignBrief("task-001", "acme", makeDirection());

    expect(brief.id).toBeTruthy();
    expect(typeof brief.id).toBe("string");
    expect(brief.taskId).toBe("task-001");
    expect(brief.clientSlug).toBe("acme");
    expect(brief.selectedDirectionId).toBe("dir-test-001");
    expect(typeof brief.aesthetic).toBe("string");
    expect(typeof brief.composition).toBe("string");
    expect(typeof brief.hierarchy).toBe("string");
    expect(typeof brief.typography).toBe("string");
    expect(Array.isArray(brief.colors)).toBe(true);
    expect(typeof brief.imageStrategy).toBe("string");
    expect(typeof brief.interactionCharacter).toBe("string");
    expect(typeof brief.responsiveBehavior).toBe("string");
    expect(Array.isArray(brief.antiPatterns)).toBe(true);
    expect(brief.createdAt).toBeTruthy();
    expect(brief.updatedAt).toBeTruthy();
  });

  it('maps "geometric-modern" typography to correct aesthetic', () => {
    const brief = createDesignBrief(
      "task-001",
      "acme",
      makeDirection({ "typography-character": "geometric-modern" }),
    );
    expect(brief.aesthetic).toBe(
      "Clean, mathematical precision with sharp lines and geometric shapes",
    );
  });

  it('maps "humanist-warm" typography to correct aesthetic', () => {
    const brief = createDesignBrief(
      "task-001",
      "acme",
      makeDirection({ "typography-character": "humanist-warm" }),
    );
    expect(brief.aesthetic).toBe(
      "Organic and inviting, with rounded forms and natural flow",
    );
  });

  it('maps "spacious-editorial" layout to correct composition', () => {
    const brief = createDesignBrief(
      "task-001",
      "acme",
      makeDirection({ "layout-density": "spacious-editorial" }),
    );
    expect(brief.composition).toBe(
      "Generous margins and breathing room; content floats in ample whitespace",
    );
  });

  it('maps "compact-information-dense" layout to correct composition', () => {
    const brief = createDesignBrief(
      "task-001",
      "acme",
      makeDirection({ "layout-density": "compact-information-dense" }),
    );
    expect(brief.composition).toBe(
      "High-density layout maximizing visible content per viewport",
    );
  });

  it("maps each hierarchy-strategy position correctly", () => {
    const expected: Record<string, string> = {
      "hero-dominant":
        "Single dominant visual anchors each section; clear focal points guide the eye",
      "grid-equal-weight":
        "Content distributed evenly across a structured grid; democratic layout",
      "progressive-reveal":
        "Layered content disclosure; each scroll reveals the next level of detail",
      "sidebar-content":
        "Persistent sidebar provides context while main column carries content",
    };
    for (const [position, hierarchy] of Object.entries(expected)) {
      const brief = createDesignBrief(
        "task-001",
        "acme",
        makeDirection({ "hierarchy-strategy": position }),
      );
      expect(brief.hierarchy).toBe(hierarchy);
    }
  });

  it("maps each interaction-weight position correctly", () => {
    const expected: Record<string, string> = {
      "minimal-static":
        "No motion; instant state changes; content-first, zero distraction",
      "subtle-transitions":
        "Gentle fades and slides easing cognitive transitions",
      "rich-animated":
        "Purposeful motion design reinforcing spatial relationships and feedback",
      "scroll-driven":
        "Scroll-triggered reveals and parallax layers creating narrative depth",
    };
    for (const [position, interaction] of Object.entries(expected)) {
      const brief = createDesignBrief(
        "task-001",
        "acme",
        makeDirection({ "interaction-weight": position }),
      );
      expect(brief.interactionCharacter).toBe(interaction);
    }
  });

  it("maps each imagery-role position correctly", () => {
    const expected: Record<string, string> = {
      "photography-led":
        "Photography as the primary visual driver; full-bleed and hero imagery",
      "illustration-led":
        "Custom illustrations convey brand personality and abstract concepts",
      "icon-led":
        "Systematic iconography providing visual shorthand and pattern recognition",
      "typography-only":
        "Type is the image; scale, weight, and spacing create visual interest",
    };
    for (const [position, strategy] of Object.entries(expected)) {
      const brief = createDesignBrief(
        "task-001",
        "acme",
        makeDirection({ "imagery-role": position }),
      );
      expect(brief.imageStrategy).toBe(strategy);
    }
  });

  it('maps "cool-professional" color to correct hex palette', () => {
    const brief = createDesignBrief(
      "task-001",
      "acme",
      makeDirection({ "color-temperature": "cool-professional" }),
    );
    expect(brief.colors).toEqual([
      "#1a365d",
      "#2b6cb0",
      "#e2e8f0",
      "#f7fafc",
      "#2d3748",
    ]);
  });

  it("derives anti-patterns from all axis positions", () => {
    const direction = makeDirection();
    const brief = createDesignBrief("task-001", "acme", direction);

    // Should include anti-patterns for each default axis position
    expect(brief.antiPatterns.length).toBeGreaterThan(0);

    // Check a few known entries from the defaults
    // "balanced-standard" layout
    expect(brief.antiPatterns).toContain(
      "Avoid extreme whitespace or extreme density",
    );
    // "geometric-modern" typography
    expect(brief.antiPatterns).toContain(
      "Avoid decorative or ornamental type treatments",
    );
    // "cool-professional" color
    expect(brief.antiPatterns).toContain(
      "Avoid warm accent colors that clash with the cool palette",
    );
    // "hero-dominant" hierarchy
    expect(brief.antiPatterns).toContain(
      "Avoid competing CTAs at the same visual weight",
    );
    // "subtle-transitions" interaction
    expect(brief.antiPatterns).toContain(
      "Avoid jarring or fast animations that contradict the gentle aesthetic",
    );
    // "photography-led" imagery
    expect(brief.antiPatterns).toContain(
      "Avoid low-quality or generic stock photography",
    );
  });

  it("falls back gracefully for unknown axis position", () => {
    const brief = createDesignBrief(
      "task-001",
      "acme",
      makeDirection({ "typography-character": "custom-fantasy" }),
    );
    expect(brief.aesthetic).toBe("Aesthetic guided by custom-fantasy");
  });

  it("preserves taskId, clientSlug, and selectedDirectionId", () => {
    const brief = createDesignBrief(
      "task-xyz-789",
      "globex-corp",
      makeDirection(),
    );
    expect(brief.taskId).toBe("task-xyz-789");
    expect(brief.clientSlug).toBe("globex-corp");
    expect(brief.selectedDirectionId).toBe("dir-test-001");
  });

  it("generates unique IDs across calls", () => {
    const brief1 = createDesignBrief("task-001", "acme", makeDirection());
    const brief2 = createDesignBrief("task-001", "acme", makeDirection());
    expect(brief1.id).not.toBe(brief2.id);
  });
});

// ─── save/load round-trip tests ────────────────────────────────────────────

describe("saveDesignBrief / loadDesignBrief", () => {
  it("saves and loads a brief round-trip", async () => {
    const brief = createDesignBrief("task-rt-001", "acme", makeDirection());
    const savedPath = await saveDesignBrief(tmpDir, brief);

    expect(fs.existsSync(savedPath)).toBe(true);

    const loaded = await loadDesignBrief(tmpDir, "task-rt-001");
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(brief.id);
    expect(loaded!.taskId).toBe(brief.taskId);
    expect(loaded!.clientSlug).toBe(brief.clientSlug);
    expect(loaded!.aesthetic).toBe(brief.aesthetic);
    expect(loaded!.colors).toEqual(brief.colors);
    expect(loaded!.antiPatterns).toEqual(brief.antiPatterns);
  });

  it("returns null for a nonexistent task", async () => {
    const loaded = await loadDesignBrief(tmpDir, "task-nonexistent-999");
    expect(loaded).toBeNull();
  });
});
