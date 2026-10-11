/**
 * Tests for the design critic module.
 */

import { describe, it, expect } from "vitest";
import {
  createCritiquePrompt,
  evaluateDesign,
} from "../../src/design/critic.js";
import type { DesignBrief } from "../../src/core/schemas.js";

const MOCK_BRIEF: DesignBrief = {
  id: "brief-001",
  taskId: "task-001",
  clientSlug: "test-client",
  selectedDirectionId: "dir-001",
  aesthetic: "Clean, mathematical precision with sharp lines",
  composition: "Generous margins and breathing room",
  hierarchy: "Single dominant visual anchors each section",
  typography: "geometric-modern",
  colors: ["#1a365d", "#2b6cb0", "#e2e8f0"],
  imageStrategy: "Photography as the primary visual driver",
  interactionCharacter: "Gentle fades and slides easing cognitive transitions",
  responsiveBehavior: "Standard responsive breakpoints",
  antiPatterns: [
    "Avoid decorative or ornamental type treatments",
    "Do not mix geometric type with highly organic imagery",
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("createCritiquePrompt", () => {
  it("includes the task description", () => {
    const prompt = createCritiquePrompt(
      ["screenshot1.png"],
      null,
      "Redesign the homepage hero",
    );
    expect(prompt).toContain("Redesign the homepage hero");
  });

  it("includes design brief fields when provided", () => {
    const prompt = createCritiquePrompt(
      ["screenshot1.png"],
      MOCK_BRIEF,
      "Redesign the homepage hero",
    );
    expect(prompt).toContain(MOCK_BRIEF.aesthetic);
    expect(prompt).toContain(MOCK_BRIEF.composition);
    expect(prompt).toContain(MOCK_BRIEF.hierarchy);
    expect(prompt).toContain(MOCK_BRIEF.typography);
    expect(prompt).toContain(MOCK_BRIEF.interactionCharacter);
  });

  it("includes anti-patterns from the brief", () => {
    const prompt = createCritiquePrompt(
      ["screenshot1.png"],
      MOCK_BRIEF,
      "Redesign the homepage hero",
    );
    for (const ap of MOCK_BRIEF.antiPatterns) {
      expect(prompt).toContain(ap);
    }
  });

  it("does NOT include implementation code", () => {
    const prompt = createCritiquePrompt(
      ["screenshot1.png"],
      MOCK_BRIEF,
      "Redesign the homepage hero",
    );
    // The prompt should focus on visual evaluation, not code
    expect(prompt).not.toContain("import ");
    expect(prompt).not.toContain("function ");
    expect(prompt).not.toContain("const ");
    expect(prompt).toContain("Visual Design Critique");
  });

  it("lists screenshot paths", () => {
    const screenshots = ["evidence/shot1.png", "evidence/shot2.png"];
    const prompt = createCritiquePrompt(screenshots, null, "Task description");
    for (const s of screenshots) {
      expect(prompt).toContain(s);
    }
  });
});

describe("evaluateDesign", () => {
  it("returns a CritiqueResult with correct structure", async () => {
    const result = await evaluateDesign({
      screenshotPaths: ["test.png"],
      taskDescription: "Test evaluation",
    });

    expect(result.id).toBeTruthy();
    expect(typeof result.id).toBe("string");
    expect(result.scores).toBeInstanceOf(Array);
    expect(result.scores.length).toBeGreaterThan(0);
    expect(typeof result.overallScore).toBe("number");
    expect(typeof result.summary).toBe("string");
    expect(result.strengths).toBeInstanceOf(Array);
    expect(result.improvements).toBeInstanceOf(Array);
    expect(result.accessibilityNotes).toBeInstanceOf(Array);
    expect(result.screenshotPaths).toEqual(["test.png"]);
    expect(result.createdAt).toBeTruthy();
  });

  it("stub returns score 0 for manual review", async () => {
    const result = await evaluateDesign({
      screenshotPaths: ["test.png"],
      taskDescription: "Test evaluation",
    });

    expect(result.overallScore).toBe(0);
    for (const score of result.scores) {
      expect(score.score).toBe(0);
      expect(score.observation).toBe("Manual review required");
    }
  });

  it("each score entry has dimension, score, observation, and suggestion", async () => {
    const result = await evaluateDesign({
      screenshotPaths: ["test.png"],
      taskDescription: "Test evaluation",
    });

    for (const score of result.scores) {
      expect(typeof score.dimension).toBe("string");
      expect(typeof score.score).toBe("number");
      expect(typeof score.observation).toBe("string");
      expect(typeof score.suggestion).toBe("string");
    }
  });

  it("includes briefId when design brief is provided", async () => {
    const result = await evaluateDesign({
      screenshotPaths: ["test.png"],
      designBrief: MOCK_BRIEF,
      taskDescription: "Test with brief",
    });

    expect(result.briefId).toBe("brief-001");
  });
});
