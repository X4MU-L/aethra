/**
 * Tests for the Agentation visual feedback provider
 * (src/visual-feedback/providers/agentation.ts).
 */

import { describe, it, expect } from "vitest";
import { AgentationProvider } from "../../../src/visual-feedback/providers/agentation.js";
import { VisualFeedbackError } from "../../../src/core/errors.js";

const provider = new AgentationProvider();

/**
 * Returns a minimal valid raw annotation with sensible defaults.
 * Pass overrides to customise individual fields per test.
 */
function makeRawAnnotation(overrides: Record<string, unknown> = {}) {
  return {
    id: "ann-001",
    comment: "Fix this button",
    elementPath: "div > button.cta",
    timestamp: 1700000000000,
    x: 100,
    y: 200,
    element: "button",
    url: "http://localhost:3000/page",
    ...overrides,
  };
}

// ─── normalize() ──────────────────────────────────────────────────────────────

describe("normalize", () => {
  // 1. Happy-path full annotation
  it("maps all fields correctly for a full annotation", () => {
    const raw = makeRawAnnotation({
      severity: "blocking",
      kind: "placement",
      intent: "fix",
      boundingBox: { x: 10, y: 20, width: 100, height: 50 },
      reactComponents: ["Button", "Hero"],
      cssClasses: ["cta", "primary"],
      sourceFile: "src/components/Button.tsx",
      accessibility: {
        role: "button",
        ariaLabel: "Submit",
        contrast: 4.5,
        violations: ["color-contrast"],
      },
      nearbyText: "Sign up now",
      _sessionId: "sess-42",
      placement: {
        component: "Card",
        width: 200,
        height: 100,
        position: "center",
      },
    });

    const result = provider.normalize(raw, "acme");

    // ID is 16-char hex derived from sha256("agentation:ann-001:acme")
    expect(result.id).toHaveLength(16);
    expect(result.id).toMatch(/^[0-9a-f]{16}$/);

    expect(result.provider).toBe("agentation");
    expect(result.providerAnnotationId).toBe("ann-001");
    expect(result.clientId).toBe("acme");
    expect(result.sessionId).toBe("sess-42");
    expect(result.pageUrl).toBe("http://localhost:3000/page");
    expect(result.comment).toBe("Fix this button");

    // Enum mappings
    expect(result.severity).toBe("critical"); // blocking → critical
    expect(result.kind).toBe("style"); // placement → style
    expect(result.intent).toBe("fix"); // fix → fix

    // Timestamp conversion
    expect(result.createdAt).toBe(new Date(1700000000000).toISOString());

    // Element context
    expect(result.elementSelector).toBe("div > button.cta");
    expect(result.elementTag).toBe("button");
    expect(result.boundingBox).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });

    // Code context
    expect(result.componentTree).toEqual(["Button", "Hero"]);
    expect(result.cssClasses).toEqual(["cta", "primary"]);
    expect(result.sourceFile).toBe("src/components/Button.tsx");

    // Enrichment
    expect(result.nearbyText).toBe("Sign up now");
    expect(result.accessibilityContext).toEqual({
      role: "button",
      ariaLabel: "Submit",
      contrast: 4.5,
      violations: ["color-contrast"],
    });

    // Provider metadata
    expect(result.providerMetadata).toBeDefined();
    expect(result.providerMetadata!.placement).toEqual({
      component: "Card",
      width: 200,
      height: 100,
      position: "center",
    });
    expect(result.providerMetadata!.originalKind).toBe("placement");

    expect(result.status).toBe("pending");
  });

  // 2. ISO timestamp passthrough
  it("passes through an ISO timestamp string unchanged", () => {
    const iso = "2024-06-15T10:30:00.000Z";
    const raw = makeRawAnnotation({ timestamp: iso });
    const result = provider.normalize(raw, "client");
    expect(result.createdAt).toBe(iso);
  });

  // 3. Missing URL throws
  it("throws VisualFeedbackError when url is missing", () => {
    const raw = makeRawAnnotation({ url: undefined });
    delete (raw as Record<string, unknown>).url;

    expect(() => provider.normalize(raw, "client")).toThrow(
      VisualFeedbackError,
    );
    expect(() => provider.normalize(raw, "client")).toThrow(/no URL/);
  });

  // 4. Zod validation rejects bad input
  it("throws VisualFeedbackError when required fields are missing", () => {
    const bad = { id: "bad-1", url: "http://localhost:3000" };

    expect(() => provider.normalize(bad, "client")).toThrow(
      VisualFeedbackError,
    );
  });

  // 5. Default enum mapping (no severity/kind/intent)
  it("defaults to severity=medium, intent=fix when enums omitted", () => {
    const raw = makeRawAnnotation();
    // raw has no severity, kind, or intent
    const result = provider.normalize(raw, "client");

    expect(result.severity).toBe("medium");
    expect(result.intent).toBe("fix");
  });

  // 6. Stable ID is deterministic
  it("produces the same ID for the same inputs", () => {
    const raw = makeRawAnnotation();
    const id1 = provider.normalize(raw, "client-a").id;
    const id2 = provider.normalize(raw, "client-a").id;
    expect(id1).toBe(id2);
  });

  // 7. Different client slug yields different ID
  it("produces different IDs for different client slugs", () => {
    const raw = makeRawAnnotation();
    const id1 = provider.normalize(raw, "client-a").id;
    const id2 = provider.normalize(raw, "client-b").id;
    expect(id1).not.toBe(id2);
  });

  // ─── Kind inference from comment text ───────────────────────────────────────

  it('infers kind "bug" from comment containing "bug"', () => {
    const raw = makeRawAnnotation({
      comment: "There is a bug here",
      kind: "feedback",
    });
    expect(provider.normalize(raw, "c").kind).toBe("bug");
  });

  it('infers kind "bug" from comment containing "broken"', () => {
    const raw = makeRawAnnotation({
      comment: "This is broken",
      kind: "feedback",
    });
    expect(provider.normalize(raw, "c").kind).toBe("bug");
  });

  it('infers kind "style" from comment containing "css"', () => {
    const raw = makeRawAnnotation({
      comment: "The css is off",
      kind: "feedback",
    });
    expect(provider.normalize(raw, "c").kind).toBe("style");
  });

  it('infers kind "accessibility" from comment containing "a11y"', () => {
    const raw = makeRawAnnotation({
      comment: "Check a11y on this",
      kind: "feedback",
    });
    expect(provider.normalize(raw, "c").kind).toBe("accessibility");
  });

  it('infers kind "content" from comment containing "text"', () => {
    const raw = makeRawAnnotation({
      comment: "The text is wrong",
      kind: "feedback",
    });
    expect(provider.normalize(raw, "c").kind).toBe("content");
  });

  it('infers kind "enhancement" from comment containing "improve"', () => {
    const raw = makeRawAnnotation({
      comment: "Can you improve this?",
      kind: "feedback",
    });
    // Note: "improve" triggers enhancement, but "?" also matches question.
    // "improve" is checked first in the provider's inferKindFromComment.
    expect(provider.normalize(raw, "c").kind).toBe("enhancement");
  });

  it('infers kind "question" from comment containing "?"', () => {
    const raw = makeRawAnnotation({
      comment: "Is this right?",
      kind: "feedback",
    });
    expect(provider.normalize(raw, "c").kind).toBe("question");
  });

  it('infers kind "other" for a generic comment', () => {
    const raw = makeRawAnnotation({
      comment: "Please update the logo",
      kind: "feedback",
    });
    expect(provider.normalize(raw, "c").kind).toBe("other");
  });

  // 16. Rearrange kind mapping
  it('maps kind "rearrange" to "enhancement" and preserves originalKind', () => {
    const raw = makeRawAnnotation({
      kind: "rearrange",
      rearrange: {
        originalBounds: { x: 0, y: 0, width: 100, height: 50 },
        currentBounds: { x: 10, y: 20, width: 100, height: 50 },
      },
    });
    const result = provider.normalize(raw, "client");

    expect(result.kind).toBe("enhancement");
    expect(result.providerMetadata).toBeDefined();
    expect(result.providerMetadata!.originalKind).toBe("rearrange");
    expect(result.providerMetadata!.rearrange).toEqual({
      originalBounds: { x: 0, y: 0, width: 100, height: 50 },
      currentBounds: { x: 10, y: 20, width: 100, height: 50 },
    });
  });

  // 17. Unknown severity falls through to "medium"
  it('maps an unrecognised severity to "medium"', () => {
    const raw = makeRawAnnotation({ severity: "unknown_val" });
    const result = provider.normalize(raw, "client");
    expect(result.severity).toBe("medium");
  });
});

// ─── startSession() URL guard ─────────────────────────────────────────────────

describe("startSession", () => {
  it("rejects a production URL before making any HTTP call", async () => {
    const result = await provider.startSession({
      pageUrl: "https://example.com",
      clientSlug: "test",
      sessionId: "sess-1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/local\/development/);
  });
});
