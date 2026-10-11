/**
 * Tests for the task classifier.
 */

import { describe, it, expect } from "vitest";
import { classifyTask } from "../../src/design/task-classifier.js";

describe("classifyTask", () => {
  it('classifies "fix the broken checkout button" as direct-fix', () => {
    const result = classifyTask("fix the broken checkout button");
    expect(result.classification).toBe("direct-fix");
    expect(result.requiresDesignWorkflow).toBe(false);
  });

  it('classifies "redesign the homepage hero section" as design-exploration', () => {
    const result = classifyTask("redesign the homepage hero section");
    expect(result.classification).toBe("design-exploration");
    expect(result.requiresDesignWorkflow).toBe(true);
  });

  it('classifies "create an architecture diagram" as technical-illustration', () => {
    const result = classifyTask("create an architecture diagram");
    expect(result.classification).toBe("technical-illustration");
    expect(result.requiresDesignWorkflow).toBe(true);
  });

  it('classifies "refactor the API endpoints" as conventional-engineering', () => {
    const result = classifyTask("refactor the API endpoints");
    expect(result.classification).toBe("conventional-engineering");
    expect(result.requiresDesignWorkflow).toBe(false);
  });

  it('classifies "improve the landing page design" as design-exploration', () => {
    const result = classifyTask("improve the landing page design");
    expect(result.classification).toBe("design-exploration");
    expect(result.requiresDesignWorkflow).toBe(true);
  });

  it('classifies "fix alignment issue in the header" as direct-fix', () => {
    const result = classifyTask("fix alignment issue in the header");
    expect(result.classification).toBe("direct-fix");
    expect(result.requiresDesignWorkflow).toBe(false);
  });

  it('classifies "deploy the application" as conventional-engineering', () => {
    const result = classifyTask("deploy the application");
    expect(result.classification).toBe("conventional-engineering");
    expect(result.requiresDesignWorkflow).toBe(false);
  });

  it("returns direct-fix with low confidence for a generic task with no keywords", () => {
    const result = classifyTask("do the thing with the stuff");
    expect(result.classification).toBe("direct-fix");
    expect(result.confidence).toBeLessThanOrEqual(0.3);
    expect(result.signals).toHaveLength(0);
  });

  it("sets requiresDesignWorkflow true for design-exploration", () => {
    const result = classifyTask("redesign the entire checkout flow");
    expect(result.classification).toBe("design-exploration");
    expect(result.requiresDesignWorkflow).toBe(true);
  });

  it("sets requiresDesignWorkflow true for technical-illustration", () => {
    const result = classifyTask("create a flow chart for the CI pipeline");
    expect(result.classification).toBe("technical-illustration");
    expect(result.requiresDesignWorkflow).toBe(true);
  });

  it("returns confidence as a number between 0 and 1", () => {
    const tasks = [
      "fix the broken checkout button",
      "redesign the homepage hero section",
      "create an architecture diagram",
      "refactor the API endpoints",
      "do something random",
    ];

    for (const task of tasks) {
      const result = classifyTask(task);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(typeof result.confidence).toBe("number");
    }
  });
});
