/**
 * End-to-end integration test: full design intelligence pipeline.
 *
 * Proves the complete flow from task classification through direction
 * planning, brief creation, and design critique works as a cohesive
 * pipeline with correct data persistence and round-tripping.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import path from "path";
import os from "os";

import { classifyTask } from "../../src/design/task-classifier.js";
import {
  planDesignDirections,
  saveDesignDirections,
  loadDesignDirections,
} from "../../src/design/direction-planner.js";
import {
  createDesignBrief,
  saveDesignBrief,
  loadDesignBrief,
} from "../../src/design/design-brief.js";
import {
  evaluateDesign,
  saveCritique,
  loadCritique,
  createCritiquePrompt,
} from "../../src/design/critic.js";

import type {
  DesignDirection,
  DesignBrief,
  CritiqueResult,
} from "../../src/core/schemas.js";

// ─── Shared state ─────────────────────────────────────────────────────────────

let workspace: string;
let directions: DesignDirection[];
let brief: DesignBrief;
let critique: CritiqueResult;

beforeAll(() => {
  workspace = mkdtempSync(path.join(os.tmpdir(), "aethra-design-pipeline-"));
  mkdirSync(path.join(workspace, "tasks"), { recursive: true });
  mkdirSync(path.join(workspace, "evidence", "design-critiques"), {
    recursive: true,
  });
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// ─── Pipeline tests ──────────────────────────────────────────────────────────

describe("design intelligence pipeline — end-to-end", () => {
  it("step 1: classify task", () => {
    const result = classifyTask("redesign the homepage hero section");

    expect(result.classification).toBe("design-exploration");
    expect(result.requiresDesignWorkflow).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("step 2: generate design directions", async () => {
    directions = planDesignDirections(
      "redesign the homepage hero section",
      undefined,
      4,
      42,
    );

    expect(directions).toHaveLength(4);

    for (const dir of directions) {
      expect(dir.axes).toHaveLength(6);
      expect(dir.id).toBeTruthy();
      expect(dir.name).toBeTruthy();
      expect(dir.rationale).toBeTruthy();
    }

    // Persist for subsequent steps
    await saveDesignDirections(workspace, "test-task", directions);
  });

  it("step 3: create design brief from first direction", async () => {
    brief = createDesignBrief("test-task", "test-client", directions[0]);

    expect(brief.id).toBeTruthy();
    expect(brief.taskId).toBe("test-task");
    expect(brief.clientSlug).toBe("test-client");
    expect(brief.selectedDirectionId).toBe(directions[0].id);
    expect(brief.aesthetic).toBeTruthy();
    expect(brief.composition).toBeTruthy();
    expect(brief.hierarchy).toBeTruthy();
    expect(brief.antiPatterns.length).toBeGreaterThan(0);

    await saveDesignBrief(workspace, brief);
  });

  it("step 4: load brief round-trips correctly", async () => {
    const loaded = await loadDesignBrief(workspace, "test-task");

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(brief.id);
    expect(loaded!.aesthetic).toBe(brief.aesthetic);
    expect(loaded!.composition).toBe(brief.composition);
    expect(loaded!.hierarchy).toBe(brief.hierarchy);
    expect(loaded!.selectedDirectionId).toBe(brief.selectedDirectionId);
  });

  it("step 5: run design critique", async () => {
    critique = await evaluateDesign({
      screenshotPaths: ["/tmp/test.png"],
      designBrief: brief,
      taskDescription: "redesign hero",
    });

    expect(critique.reviewStatus).toBe("pending");
    expect(critique.critiquePrompt).toBeTruthy();
    expect(critique.critiquePrompt?.length).toBeGreaterThan(0);
    expect(critique.critiquePrompt).toContain("redesign hero");

    // Attach task id for persistence
    critique.taskId = "test-task";

    await saveCritique(workspace, critique);
  });

  it("step 6: load critique round-trips correctly", async () => {
    const loaded = await loadCritique(workspace, "test-task");

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(critique.id);
    expect(loaded!.reviewStatus).toBe(critique.reviewStatus);
    expect(loaded!.taskId).toBe("test-task");
  });

  it("step 7: critique prompt quality", () => {
    const prompt = createCritiquePrompt(
      ["/tmp/test.png"],
      brief,
      "redesign hero",
    );

    // Contains key evaluation sections
    expect(prompt).toContain("Aesthetic");

    // Contains at least one anti-pattern from the brief
    const hasAntiPattern = brief.antiPatterns.some((ap) => prompt.includes(ap));
    expect(hasAntiPattern).toBe(true);

    // Contains the visual-hierarchy evaluation dimension
    expect(prompt).toContain("visual-hierarchy");
  });
});
