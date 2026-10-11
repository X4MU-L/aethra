/**
 * Claude Code agent adapter.
 * Prepares structured context and optionally launches Claude Code.
 */

import path from "path";
import { commandExists } from "../engine/subprocess.js";
import { writeFile, ensureDir } from "../engine/fs.js";
import { logger } from "../core/logger.js";
import type { AgentAdapter, AgentContext, AgentResult } from "./adapter.js";

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = "claude-code";

  async isAvailable(): Promise<boolean> {
    return commandExists("claude");
  }

  async prepareContext(ctx: AgentContext): Promise<string> {
    const taskDir = ctx.taskId
      ? path.join(ctx.workspacePath, "tasks", ctx.taskId)
      : path.join(ctx.workspacePath, "plans");
    await ensureDir(taskDir);

    const instructionPath = path.join(taskDir, "agent-instructions.md");

    const sections: string[] = [
      `# Implementation Instructions`,
      "",
      `**Plan:** ${ctx.plan.title}`,
      `**Plan ID:** ${ctx.plan.id}`,
      `**Client:** ${ctx.plan.clientSlug}`,
      ctx.gitBranch ? `**Branch:** ${ctx.gitBranch}` : "",
      "",
      `## Task Description`,
      "",
      ctx.plan.taskDescription,
      "",
    ];

    if (ctx.plan.rootCause) {
      sections.push(`## Root Cause`, "", ctx.plan.rootCause, "");
    }

    if (ctx.plan.proposedChanges.length > 0) {
      sections.push(`## Proposed Changes`, "");
      for (const change of ctx.plan.proposedChanges) {
        sections.push(`### ${change.description}`);
        if (change.rationale) sections.push("", change.rationale);
        if (change.files.length > 0) {
          sections.push("", "Files:", ...change.files.map((f) => `- \`${f}\``));
        }
        sections.push("");
      }
    }

    if (ctx.plan.acceptanceCriteria.length > 0) {
      sections.push(`## Acceptance Criteria`, "");
      for (const ac of ctx.plan.acceptanceCriteria) {
        sections.push(`- [ ] ${ac.description}`);
        sections.push(`  - Category: ${ac.category}`);
        sections.push(`  - Verify: ${ac.verificationMethod}`);
      }
      sections.push("");
    }

    if (ctx.plan.affectedFiles.length > 0) {
      sections.push(
        `## Affected Files`,
        "",
        ...ctx.plan.affectedFiles.map((f) => `- \`${f}\``),
        "",
      );
    }

    if (ctx.plan.risks.length > 0) {
      sections.push(`## Risks`, "", ...ctx.plan.risks.map((r) => `- ${r}`), "");
    }

    if (ctx.skills.length > 0) {
      sections.push(`## Selected Skills`, "");
      for (const skill of ctx.skills) {
        sections.push(
          `- **${skill.name}**: ${skill.description} _(${skill.reason})_`,
        );
      }
      sections.push("");
    }

    if (ctx.evidencePaths.length > 0) {
      sections.push(
        `## Evidence`,
        "",
        ...ctx.evidencePaths.map((p) => `- \`${p}\``),
        "",
      );
    }

    sections.push(
      `## Safety Constraints`,
      "",
      "- Do not modify files outside the scope of this plan",
      "- Commit changes on the feature branch only",
      "- Do not push to remote without explicit approval",
      "- Preserve existing tests and functionality",
      "- Run tests before marking implementation complete",
      "",
    );

    const content = sections.filter((s) => s !== undefined).join("\n");
    await writeFile(instructionPath, content);
    logger.debug(`Agent instructions written to ${instructionPath}`);

    return instructionPath;
  }

  async launch(
    ctx: AgentContext,
    opts?: { dryRun?: boolean },
  ): Promise<AgentResult> {
    const instructionPath = await this.prepareContext(ctx);

    if (opts?.dryRun) {
      return {
        status: "not-available",
        agentName: this.name,
        instructionPath,
        outputLog: "Dry run — instructions prepared but agent not launched.",
      };
    }

    const available = await this.isAvailable();
    if (!available) {
      return {
        status: "not-available",
        agentName: this.name,
        instructionPath,
        error: "Claude Code CLI not found. Install it or launch manually.",
      };
    }

    // Context prepared but auto-launch requires interactive terminal support.
    // The instruction file is the primary deliverable.
    return {
      status: "prepared",
      agentName: this.name,
      instructionPath,
      outputLog:
        "Agent instructions prepared. Launch Claude Code manually from the repository directory.",
    };
  }
}
