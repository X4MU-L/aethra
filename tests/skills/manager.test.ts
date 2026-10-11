/**
 * Tests for the skills manager.
 */

import { describe, it, expect } from "vitest";
import path from "path";
import {
  parseSkillFile,
  validateSkill,
  listSkillsFromDir,
} from "../../src/skills/manager.js";

const BUILTIN_SKILLS_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "../../templates/skills",
);

const SAMPLE_SKILL = `---
name: test-skill
version: 0.1.0
description: A test skill for unit tests
status: approved
category: test
whenToInvoke: When running tests
requiredInputs: []
preconditions: []
requiredTools:
  - node
requiredPermissions:
  - local-file-creation
expectedOutputs:
  - Test output
safetyConstraints:
  - Do not do anything dangerous
examples:
  - aethra test
createdAt: "2024-01-01T00:00:00.000Z"
updatedAt: "2024-01-01T00:00:00.000Z"
---

# Test Skill

This is a test skill. Use it in unit tests.

## Steps

1. Do the thing
2. Verify the thing
`;

describe("parseSkillFile", () => {
  it("parses a valid skill file", () => {
    const skill = parseSkillFile(SAMPLE_SKILL, "/tmp/test-skill.md");
    expect(skill).not.toBeNull();
    expect(skill?.metadata.name).toBe("test-skill");
    expect(skill?.metadata.version).toBe("0.1.0");
    expect(skill?.metadata.status).toBe("approved");
    expect(skill?.content).toContain("Test Skill");
  });

  it("returns null for invalid frontmatter", () => {
    const skill = parseSkillFile("No frontmatter here", "/tmp/bad.md");
    expect(skill).toBeNull();
  });

  it("returns null for malformed YAML", () => {
    const skill = parseSkillFile(
      "---\n: invalid: yaml:\n---\nContent",
      "/tmp/bad.md",
    );
    expect(skill).toBeNull();
  });
});

describe("validateSkill", () => {
  it("validates a well-formed skill", () => {
    const result = validateSkill(SAMPLE_SKILL, "/tmp/test-skill.md");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("reports errors for missing frontmatter", () => {
    const result = validateSkill("No frontmatter", "/tmp/bad.md");
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("warns for very short body", () => {
    const shortSkill = `---
name: short
version: 0.1.0
description: Short skill
status: approved
category: test
whenToInvoke: test
createdAt: "2024-01-01T00:00:00.000Z"
updatedAt: "2024-01-01T00:00:00.000Z"
---
Short.`;
    const result = validateSkill(shortSkill, "/tmp/short.md");
    expect(result.warnings.some((w) => w.includes("short"))).toBe(true);
  });
});

describe("listSkillsFromDir", () => {
  it("lists built-in skills from templates directory", async () => {
    const skills = await listSkillsFromDir(BUILTIN_SKILLS_DIR, "global");
    expect(skills.length).toBeGreaterThan(0);

    // Every skill should have valid metadata
    for (const skill of skills) {
      expect(skill.metadata.name).toBeTruthy();
      expect(skill.metadata.description).toBeTruthy();
      expect(skill.metadata.status).toBeTruthy();
    }
  });

  it("returns empty array for non-existent directory", async () => {
    const skills = await listSkillsFromDir(
      "/tmp/nonexistent-aethra-skills",
      "global",
    );
    expect(skills).toEqual([]);
  });
});

describe("validateSkill — capability checking", () => {
  it("warns when requiredTools references unknown capability", () => {
    const result = validateSkill(SAMPLE_SKILL, "/tmp/test.md", {
      knownCapabilities: ["browser-screenshot", "lighthouse-audit"],
    });
    expect(result.warnings.some((w) => w.includes('"node"'))).toBe(true);
    expect(
      result.warnings.some((w) => w.includes("not a registered capability")),
    ).toBe(true);
  });

  it("does not warn when requiredTools match known capabilities", () => {
    const result = validateSkill(SAMPLE_SKILL, "/tmp/test.md", {
      knownCapabilities: ["node"],
    });
    expect(
      result.warnings.some((w) => w.includes("not a registered capability")),
    ).toBe(false);
  });

  it("skips capability check when no knownCapabilities provided", () => {
    const result = validateSkill(SAMPLE_SKILL, "/tmp/test.md");
    expect(
      result.warnings.some((w) => w.includes("not a registered capability")),
    ).toBe(false);
  });
});
