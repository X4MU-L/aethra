/**
 * Tests for workspace creation engine.
 * Uses temporary directories — never touches real client workspaces.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "fs-extra";
import {
  createWorkspaceStructure,
  buildClientConfig,
  generateReadme,
  generateClaudeMd,
  generateAgentsMd,
  buildInitialWorkspaceState,
  WORKSPACE_DIRS,
} from "../../src/engine/workspace.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aethra-test-"));
});

afterEach(async () => {
  await fs.remove(tmpDir);
});

describe("createWorkspaceStructure", () => {
  it("creates all required directories", async () => {
    await createWorkspaceStructure(tmpDir);

    for (const dir of WORKSPACE_DIRS) {
      const fullPath = path.join(tmpDir, dir);
      expect(await fs.pathExists(fullPath)).toBe(true);
    }
  });

  it("creates .local/.gitignore with correct content", async () => {
    await createWorkspaceStructure(tmpDir);
    const gitignorePath = path.join(tmpDir, ".local", ".gitignore");
    expect(await fs.pathExists(gitignorePath)).toBe(true);
    const content = await fs.readFile(gitignorePath, "utf8");
    expect(content).toContain("*");
    expect(content).toContain("!.gitignore");
  });

  it("is idempotent — can be called twice safely", async () => {
    await createWorkspaceStructure(tmpDir);
    await createWorkspaceStructure(tmpDir);
    // No errors thrown
    expect(true).toBe(true);
  });
});

describe("buildClientConfig", () => {
  it("builds a valid client config from facts", () => {
    const facts = {
      name: "EkeBoss Restaurant",
      slug: "ekeboss",
      primaryUrl: "https://ekeboss.example.com",
      knownPlatform: "wordpress" as const,
    };
    const config = buildClientConfig(facts, tmpDir);

    expect(config.name).toBe("EkeBoss Restaurant");
    expect(config.slug).toBe("ekeboss");
    expect(config.platform).toBe("wordpress");
    expect(config.workspace).toBe(tmpDir);
  });

  it("uses defaults when facts are minimal", () => {
    const config = buildClientConfig({}, tmpDir);
    expect(config.name).toBe("Unknown Client");
    expect(config.slug).toBe("unknown");
    expect(config.auditSettings.maxPages).toBe(50);
  });
});

describe("generateReadme", () => {
  it("generates a README with client information", () => {
    const now = new Date().toISOString();
    const facts = { name: "EkeBoss Restaurant", slug: "ekeboss" };
    const config = buildClientConfig(facts, tmpDir);
    const readme = generateReadme(facts, config);

    expect(readme).toContain("EkeBoss Restaurant");
    expect(readme).toContain("aethra audit");
    expect(readme).toContain("aethra plan-fix");
    expect(readme).not.toContain("undefined");
  });
});

describe("generateClaudeMd", () => {
  it("generates CLAUDE.md without secrets", () => {
    const facts = {
      name: "Test Client",
      slug: "test",
      description: "A test client",
      constraints: ["No production access"],
    };
    const config = buildClientConfig(facts, tmpDir);
    const claudeMd = generateClaudeMd(facts, config);

    expect(claudeMd).toContain("Test Client");
    expect(claudeMd).toContain("No production access");
    expect(claudeMd).toContain("No production mutations");
    expect(claudeMd).not.toMatch(/password|token|secret|api[-_]key/i);
  });
});

describe("generateAgentsMd", () => {
  it("generates AGENTS.md with role descriptions", () => {
    const facts = { name: "Test", slug: "test" };
    const config = buildClientConfig(facts, tmpDir);
    const agentsMd = generateAgentsMd(facts, config);

    expect(agentsMd).toContain("Research agent");
    expect(agentsMd).toContain("Implementation agent");
    expect(agentsMd).toContain("Planning agent");
  });
});

describe("buildInitialWorkspaceState", () => {
  it("creates empty initial state", () => {
    const state = buildInitialWorkspaceState("ekeboss");
    expect(state.clientSlug).toBe("ekeboss");
    expect(state.completedStages).toEqual([]);
    expect(state.version).toBe("1");
  });
});
