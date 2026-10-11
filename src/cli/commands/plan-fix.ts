/**
 * `aethra plan-fix "<task>"` — generate an evidence-backed implementation plan.
 * IMPORTANT: Planning must NOT modify application source files.
 */

import type { Command } from "commander";
import path from "path";
import crypto from "crypto";
import chalk from "chalk";
import { resolveClientWorkspace } from "../../config/manager.js";
import { loadLatestAudit } from "../../audit/runner.js";
import { getGitStatus } from "../../engine/git.js";
import { queryOutput } from "../../engine/subprocess.js";
import { writeJson, writeFile, ensureDir } from "../../engine/fs.js";
import { createTask } from "../../engine/tasks.js";
import { logger } from "../../core/logger.js";
import { toAethraError } from "../../core/errors.js";
import type { ImplementationPlan, EvidenceItem, PlanSnapshot } from "../../core/schemas.js";

export function registerPlanFixCommand(program: Command): void {
  program
    .command("plan-fix <task>")
    .description("Generate an evidence-backed implementation plan for a task")
    .option("--client <slug>", "Specify client by slug")
    .option("--refresh-audit", "Run a fresh audit before planning")
    .option("--json", "Output plan as JSON")
    .action(async (task: string, opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.opts()?.client;

      try {
        const { config, workspacePath } =
          await resolveClientWorkspace(clientSlug);

        console.log(chalk.bold.blue(`\n  Plan Fix — ${config.name}\n`));
        console.log(chalk.gray(`  Task: ${task}\n`));

        // 1. Load evidence
        const evidenceDir = path.join(workspacePath, "evidence");
        const latestAudit = await loadLatestAudit(evidenceDir, "baseline");

        const evidenceBasis: EvidenceItem[] = [];
        const limitations: string[] = [];

        if (latestAudit) {
          logger.info(`Using audit ${latestAudit.id} as evidence basis`);
          evidenceBasis.push(...latestAudit.artifactManifest);
        } else {
          limitations.push(
            "No baseline audit found. Run `aethra audit` first for evidence-backed planning.",
          );
          logger.warn("No baseline audit found");
        }

        // 2. Check Git status of repository (if known)
        let gitStatus = null;
        if (config.repositoryPath) {
          gitStatus = await getGitStatus(config.repositoryPath);
          if (gitStatus.hasUncommittedChanges) {
            logger.warn(
              `Repository has uncommitted changes: ${config.repositoryPath}`,
            );
            limitations.push(
              `Repository has uncommitted changes. Review before applying any fixes.`,
            );
          }
        }

        // 3. Build the plan structure
        const planId = crypto.randomBytes(8).toString("hex");
        const now = new Date().toISOString();
        const planSlug = task
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .slice(0, 40);

        const plan: ImplementationPlan = {
          id: planId,
          title: task,
          taskDescription: task,
          clientSlug: config.slug,
          status: "draft",
          createdAt: now,
          updatedAt: now,
          evidenceBasis,
          affectedFiles: [],
          affectedRoutes: [],
          rootCause: undefined,
          rootCauseConfidence: undefined,
          proposedChanges: [],
          acceptanceCriteria: [],
          risks: [],
          dependencies: [],
          openQuestions: [],
          estimatedScope: undefined,
          feedbackIds: [],
        };

        // 3b. Record plan snapshot for freshness checking
        if (config.repositoryPath && gitStatus?.isRepo) {
          const headCommit = await queryOutput('git', ['rev-parse', 'HEAD'], {
            cwd: config.repositoryPath,
          });
          const snapshot: PlanSnapshot = {
            gitCommit: headCommit ?? undefined,
            gitBranch: gitStatus.branch ?? undefined,
            auditId: latestAudit?.id,
          };
          plan.planSnapshot = snapshot;
        }

        // 4. Auto-generate acceptance criteria structure based on task keywords
        const taskLower = task.toLowerCase();
        if (taskLower.includes("mobile") || taskLower.includes("responsive")) {
          plan.acceptanceCriteria.push({
            id: `ac-${crypto.randomBytes(4).toString("hex")}`,
            description:
              "All key actions visible and functional at 375px viewport width",
            category: "visual",
            verificationMethod: "Screenshot comparison at mobile viewport",
          });
        }
        if (taskLower.includes("performance") || taskLower.includes("speed")) {
          plan.acceptanceCriteria.push({
            id: `ac-${crypto.randomBytes(4).toString("hex")}`,
            description:
              "Lighthouse performance score does not regress below current baseline",
            category: "performance",
            verificationMethod: "Lighthouse audit comparison",
          });
        }
        if (taskLower.includes("accessibility") || taskLower.includes("a11y")) {
          plan.acceptanceCriteria.push({
            id: `ac-${crypto.randomBytes(4).toString("hex")}`,
            description:
              "No new critical or high accessibility violations introduced",
            category: "accessibility",
            verificationMethod: "Automated accessibility audit comparison",
          });
        }
        if (
          taskLower.includes("form") ||
          taskLower.includes("booking") ||
          taskLower.includes("contact")
        ) {
          plan.acceptanceCriteria.push({
            id: `ac-${crypto.randomBytes(4).toString("hex")}`,
            description: "Form submits successfully with valid data",
            category: "behaviour",
            verificationMethod: "Manual or automated form test",
          });
        }

        // Always add a regression criterion
        plan.acceptanceCriteria.push({
          id: `ac-${crypto.randomBytes(4).toString("hex")}`,
          description: "No regressions in existing functionality",
          category: "behaviour",
          verificationMethod: "Automated test suite + manual review",
        });

        // 5. Note limitations
        if (limitations.length > 0) {
          plan.openQuestions.push(...limitations);
        }

        // 6. Note that this is a draft — agent should complete the investigation
        plan.proposedChanges.push({
          description:
            "[DRAFT] Agent investigation required. Run `aethra audit --refresh` to collect fresh evidence, " +
            "then use an AI agent to inspect the relevant components and complete this plan.",
          files: [],
          rationale:
            "This draft plan was auto-generated. An agent must investigate and complete it.",
        });

        plan.risks.push(
          "Plan is a draft — root cause not yet confirmed from evidence",
          "Acceptance criteria need agent review and refinement",
        );

        // 7. Save the plan
        const plansDir = path.join(workspacePath, "plans");
        await ensureDir(plansDir);

        const planJsonPath = path.join(plansDir, `${planSlug}-${planId}.json`);
        const planMdPath = path.join(plansDir, `${planSlug}-${planId}.md`);

        await writeJson(planJsonPath, plan);
        await writeFile(
          planMdPath,
          generatePlanMarkdown(plan, task, config.name),
        );

        // Create a task record to track the lifecycle of this plan
        const taskRecord = await createTask(workspacePath, planId, planJsonPath, task, config.slug);

        if (opts.json || cmd.parent?.opts()?.json) {
          console.log(JSON.stringify(plan, null, 2));
          return;
        }

        console.log(
          chalk.bold.green(`\n  Plan created: ${planSlug}-${planId}\n`),
        );
        console.log(`  Task ID:  ${chalk.cyan(taskRecord.id.slice(0, 8))}`);
        console.log(chalk.gray(`  JSON: ${planJsonPath}`));
        console.log(chalk.gray(`  Markdown: ${planMdPath}`));

        if (evidenceBasis.length > 0) {
          console.log(chalk.gray(`  Evidence items: ${evidenceBasis.length}`));
        }

        if (limitations.length > 0) {
          console.log(chalk.bold("\n  Limitations:\n"));
          for (const lim of limitations)
            console.log(chalk.yellow(`  ⚠ ${lim}`));
        }

        console.log(chalk.bold("\n  Next steps:\n"));
        console.log(chalk.gray(`  1. Review the plan: ${planMdPath}`));
        console.log(chalk.gray("  2. Use an AI agent to investigate and complete the plan"));
        console.log(chalk.gray(`  3. Approve: aethra task approve ${taskRecord.id.slice(0, 8)}`));
        console.log(chalk.gray(`  4. Verify: aethra verify --task ${taskRecord.id.slice(0, 8)}\n`));

        console.log(
          chalk.yellow(
            "\n  IMPORTANT: This is a draft plan. Do not apply it until an agent",
          ),
        );
        console.log(
          chalk.yellow(
            "  has investigated the codebase and completed the implementation details.\n",
          ),
        );
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`plan-fix failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });
}

function generatePlanMarkdown(
  plan: ImplementationPlan,
  task: string,
  clientName: string,
): string {
  const now = new Date().toISOString().split("T")[0];

  return `# Implementation Plan: ${task}

**Client:** ${clientName}
**Plan ID:** ${plan.id}
**Status:** ${plan.status.toUpperCase()}
**Created:** ${now}

> ⚠️ **DRAFT** — This plan requires agent investigation to complete. Do not apply until:
> - Root cause is confirmed from evidence
> - Proposed changes are fully specified
> - Acceptance criteria are reviewed
> - Plan status is updated to "approved"

## Task

${task}

## Evidence basis

${
  plan.evidenceBasis.length > 0
    ? plan.evidenceBasis
        .map((e) => `- \`${e.path}\` (${e.type}${e.url ? ` — ${e.url}` : ""})`)
        .join("\n")
    : "_No evidence collected yet. Run `aethra audit` to collect baseline evidence._"
}

## Root cause

_Agent investigation required._

Confidence: _Not yet assessed_

## Affected files

_To be determined by agent investigation._

## Affected routes / pages

_To be determined by agent investigation._

## Proposed changes

${plan.proposedChanges.map((c) => `### ${c.description}\n\n${c.rationale ?? ""}`).join("\n\n")}

## Acceptance criteria

${plan.acceptanceCriteria
  .map(
    (ac, i) =>
      `### AC-${i + 1}: ${ac.description}\n\n- **Category:** ${ac.category}\n- **Verification:** ${ac.verificationMethod}\n- **Passed:** _Not yet verified_`,
  )
  .join("\n\n")}

## Risks

${plan.risks.map((r) => `- ${r}`).join("\n")}

## Open questions

${
  plan.openQuestions.length > 0
    ? plan.openQuestions.map((q) => `- [ ] ${q}`).join("\n")
    : "_None at this time._"
}

## Approval

- [ ] Plan reviewed by engineer
- [ ] Root cause confirmed
- [ ] Acceptance criteria finalised
- [ ] Approved for implementation

**Approved by:** _Pending_
**Approved at:** _Pending_

---

_Generated by Aethra Workbench — aethra plan-fix_
`;
}
