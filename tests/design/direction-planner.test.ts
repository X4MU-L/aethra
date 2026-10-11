/**
 * Tests for the design direction planner.
 */

import { describe, it, expect } from "vitest";
import {
  generateDesignDirections,
  hammingDistance,
} from "../../src/design/direction-planner.js";

describe("generateDesignDirections", () => {
  it("returns the requested number of directions (4)", () => {
    const directions = generateDesignDirections(4, 42);
    expect(directions).toHaveLength(4);
  });

  it("each direction has 6 axes", () => {
    const directions = generateDesignDirections(4, 42);
    for (const dir of directions) {
      expect(dir.axes).toHaveLength(6);
    }
  });

  it("directions are structurally different (Hamming distance >= 2 between any pair)", () => {
    const directions = generateDesignDirections(4, 42);
    for (let i = 0; i < directions.length; i++) {
      for (let j = i + 1; j < directions.length; j++) {
        const posA = directions[i].axes.map((a) => a.position);
        const posB = directions[j].axes.map((a) => a.position);
        const dist = hammingDistance(posA, posB);
        expect(dist).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("same seed produces reproducible results", () => {
    const a = generateDesignDirections(4, 123);
    const b = generateDesignDirections(4, 123);

    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      const posA = a[i].axes.map((ax) => ax.position);
      const posB = b[i].axes.map((ax) => ax.position);
      expect(posA).toEqual(posB);
    }
  });

  it("returns 1 direction when count is 1", () => {
    const directions = generateDesignDirections(1, 99);
    expect(directions).toHaveLength(1);
    expect(directions[0].axes).toHaveLength(6);
  });

  it("returns 6 directions when count is 6", () => {
    const directions = generateDesignDirections(6, 55);
    expect(directions).toHaveLength(6);
  });

  it("each direction has a non-empty name and rationale", () => {
    const directions = generateDesignDirections(4, 42);
    for (const dir of directions) {
      expect(dir.name).toBeTruthy();
      expect(dir.name.length).toBeGreaterThan(0);
      expect(dir.rationale).toBeTruthy();
      expect(dir.rationale.length).toBeGreaterThan(0);
    }
  });

  it("each direction has a string id", () => {
    const directions = generateDesignDirections(4, 42);
    for (const dir of directions) {
      expect(typeof dir.id).toBe("string");
      expect(dir.id.length).toBeGreaterThan(0);
    }
  });
});

describe("hammingDistance", () => {
  it("returns 0 for identical arrays", () => {
    expect(hammingDistance(["a", "b", "c"], ["a", "b", "c"])).toBe(0);
  });

  it("returns correct distance for different arrays", () => {
    expect(hammingDistance(["a", "b", "c"], ["a", "x", "c"])).toBe(1);
    expect(hammingDistance(["a", "b", "c"], ["x", "y", "z"])).toBe(3);
  });
});
