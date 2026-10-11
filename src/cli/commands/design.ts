/**
 * `aethra design` — design intelligence command group.
 * Classify tasks, generate design directions, create briefs, and critique designs.
 */

import type { Command } from "commander";
import chalk from "chalk";
import path from "path";
import { resolveClientWorkspace } from "../../config/manager.js";
import { classifyTask } from "../../design/task-classifier.js";
import {
  planDesignDirections,
  saveDesignDirections,
} from "../../design/direction-planner.js";
import {
  createDesignBrief,
  saveDesignBrief,
  loadDesignBrief,
} from "../../design/design-brief.js";
import { evaluateDesign, saveCritique } from "../../design/critic.js";
import { readJson, pathExists } from "../../engine/fs.js";
import { loadClientFacts } from "../../engine/workspace.js";
import { logger } from "../../core/logger.js";
import { toAethraError } from "../../core/errors.js";
import type { DesignDirection } from "../../core/schemas.js";

export function registerDesignCommand(program: Command): void {
  const design = program
    .command("design")
    .description(
      "Design intelligence — classify, explore, brief, and critique",
    );

  // ── design classify <task> ──────────────────────────────────────────────────

  design
    .command("classify <task>")
    .description(
      "Classify a task description to determine if it requires design workflow",
    )
    .action(async (task: string) => {
      try {
        const result = classifyTask(task);

        console.log(chalk.bold.blue("\n  Task Classification\n"));
        console.log(`  Task:        ${chalk.white(task)}`);
        console.log(`  Class:       ${chalk.cyan(result.classification)}`);
        console.log(
          `  Confidence:  ${chalk.yellow(String(result.confidence.toFixed(2)))}`,
        );
        console.log(`  Reasoning:   ${chalk.gray(result.reasoning)}`);

        if (result.signals.length > 0) {
          console.log(chalk.bold("\n  Signals:\n"));
          for (const signal of result.signals) {
            console.log(`    - ${signal}`);
          }
        }

        const workflowLabel = result.requiresDesignWorkflow
          ? chalk.green("Yes — design exploration recommended")
          : chalk.gray("No — direct implementation path");
        console.log(`\n  Design workflow: ${workflowLabel}\n`);
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`classify failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });

  // ── design directions <task> ────────────────────────────────────────────────

  design
    .command("directions <task>")
    .description("Generate diverse design directions for a task")
    .option("--count <n>", "Number of directions to generate", "4")
    .option("--seed <n>", "Random seed for reproducible results")
    .option("--client <slug>", "Specify client by slug")
    .option("--task-id <id>", "Task ID to save directions to workspace")
    .action(async (task: string, opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;
      const count = parseInt(opts.count, 10);
      const seed =
        opts.seed !== undefined ? parseInt(opts.seed, 10) : undefined;

      try {
        // Load client facts if available
        let clientFacts:
          | { constraints?: string[]; desiredOutcomes?: string[] }
          | undefined;
        if (clientSlug) {
          try {
            const { workspacePath } = await resolveClientWorkspace(clientSlug);
            const facts = await loadClientFacts(workspacePath);
            if (facts) {
              clientFacts = {
                constraints: facts.constraints ?? [],
                desiredOutcomes: facts.objectives ?? [],
              };
            }
          } catch {
            logger.debug(
              "Could not load client facts; proceeding without them",
            );
          }
        }

        const directions = planDesignDirections(task, clientFacts, count, seed);

        console.log(
          chalk.bold.blue(`\n  Design Directions — ${count} generated\n`),
        );
        console.log(chalk.gray(`  Task: ${task}`));
        if (seed !== undefined) console.log(chalk.gray(`  Seed: ${seed}`));
        console.log();

        for (const [i, dir] of directions.entries()) {
          console.log(
            chalk.bold(`  ${i + 1}. ${dir.name}`) + chalk.gray(` (${dir.id})`),
          );
          console.log(chalk.gray(`     ${dir.rationale}`));
          console.log();

          for (const axis of dir.axes) {
            console.log(
              `     ${chalk.cyan(axis.axis.padEnd(22))} ${axis.position}`,
            );
            console.log(
              chalk.gray(`     ${"".padEnd(22)} ${axis.description}`),
            );
          }
          console.log();
        }

        // Save to workspace if task ID provided
        if (opts.taskId && clientSlug) {
          try {
            const { workspacePath } = await resolveClientWorkspace(clientSlug);
            const saved = await saveDesignDirections(
              workspacePath,
              opts.taskId,
              directions,
            );
            console.log(chalk.cyan(`  Saved: ${saved}\n`));
          } catch (err) {
            logger.warn(`Could not save directions: ${(err as Error).message}`);
          }
        }
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`directions failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });

  // ── design brief <task-id> ──────────────────────────────────────────────────

  design
    .command("brief <task-id>")
    .description("Create a design brief from a selected direction")
    .requiredOption(
      "--direction <direction-id>",
      "ID of the selected design direction",
    )
    .option("--client <slug>", "Specify client by slug")
    .action(async (taskId: string, opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;

      try {
        if (!clientSlug) {
          logger.error(
            "Client slug required. Use --client <slug> or the global --client flag.",
          );
          process.exit(1);
        }

        const { workspacePath } = await resolveClientWorkspace(clientSlug);
        const directionsPath = path.join(
          workspacePath,
          "tasks",
          taskId,
          "design-directions.json",
        );

        if (!(await pathExists(directionsPath))) {
          logger.error(
            `No design-directions.json found for task ${taskId}. Run 'aethra design directions' first.`,
          );
          process.exit(1);
        }

        const directions = await readJson<DesignDirection[]>(directionsPath);
        const selected = directions.find((d) => d.id === opts.direction);

        if (!selected) {
          logger.error(`Direction not found: ${opts.direction}`);
          logger.info(
            `Available directions: ${directions.map((d) => d.id).join(", ")}`,
          );
          process.exit(1);
        }

        const brief = createDesignBrief(taskId, clientSlug, selected);
        const saved = await saveDesignBrief(workspacePath, brief);

        console.log(chalk.bold.blue(`\n  Design Brief — ${taskId}\n`));
        console.log(`  ID:            ${chalk.gray(brief.id)}`);
        console.log(
          `  Direction:     ${chalk.cyan(selected.name)} (${selected.id})`,
        );
        console.log(`  Aesthetic:     ${brief.aesthetic}`);
        console.log(`  Composition:   ${brief.composition}`);
        console.log(`  Hierarchy:     ${brief.hierarchy}`);
        console.log(`  Typography:    ${brief.typography}`);
        console.log(`  Colors:        ${brief.colors.join(", ")}`);
        console.log(`  Image:         ${brief.imageStrategy}`);
        console.log(`  Interaction:   ${brief.interactionCharacter}`);
        console.log(`  Responsive:    ${brief.responsiveBehavior}`);

        if (brief.antiPatterns.length > 0) {
          console.log(chalk.bold("\n  Anti-patterns:\n"));
          for (const ap of brief.antiPatterns) {
            console.log(chalk.red(`    - ${ap}`));
          }
        }

        console.log(chalk.cyan(`\n  Saved: ${saved}\n`));
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`brief failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });

  // ── design critique <task-id> ──────────────────────────────────────────────

  design
    .command("critique <task-id>")
    .description(
      "Run the design critic against a task's design brief and screenshots",
    )
    .option("--client <slug>", "Specify client by slug")
    .action(async (taskId: string, opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;

      try {
        if (!clientSlug) {
          logger.error(
            "Client slug required. Use --client <slug> or the global --client flag.",
          );
          process.exit(1);
        }

        const { workspacePath } = await resolveClientWorkspace(clientSlug);

        // Load design brief
        const brief = await loadDesignBrief(workspacePath, taskId);
        if (!brief) {
          logger.warn(
            `No design brief found for task ${taskId}. Critique will proceed without brief context.`,
          );
        }

        // Look for screenshots (check both root and run-specific subdirectories)
        const screenshotsDir = path.join(
          workspacePath,
          "evidence",
          "screenshots",
        );
        const screenshotPaths: string[] = [];
        if (await pathExists(screenshotsDir)) {
          const { promises: fs } = await import("fs");
          const entries = await fs.readdir(screenshotsDir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(screenshotsDir, entry.name);
            if (entry.isFile() && /\.(png|jpg|jpeg|webp)$/i.test(entry.name)) {
              screenshotPaths.push(fullPath);
            } else if (entry.isDirectory()) {
              const subEntries = await fs.readdir(fullPath);
              for (const sub of subEntries) {
                if (/\.(png|jpg|jpeg|webp)$/i.test(sub)) {
                  screenshotPaths.push(path.join(fullPath, sub));
                }
              }
            }
          }
        }

        if (screenshotPaths.length === 0) {
          console.log(
            chalk.yellow("\n  No screenshots found in evidence/screenshots/"),
          );
          console.log(
            chalk.gray(
              "  Run an audit with screenshots first, or add images manually.\n",
            ),
          );
        }

        console.log(chalk.bold.blue(`\n  Design Critique — ${taskId}\n`));
        console.log(chalk.gray(`  Screenshots: ${screenshotPaths.length}`));
        console.log(chalk.gray(`  Brief: ${brief ? brief.id : "none"}\n`));

        const critique = await evaluateDesign({
          screenshotPaths,
          designBrief: brief ?? undefined,
          taskDescription: `Task ${taskId}`,
        });

        // Set taskId for persistence and lookup
        critique.taskId = taskId;

        // Save critique
        const saved = await saveCritique(workspacePath, critique);

        // Show review status
        if (critique.reviewStatus === "pending") {
          console.log(
            chalk.yellow(
              "  Status: Pending review (model integration pending)\n",
            ),
          );
          console.log(
            chalk.gray(
              "  A critique prompt has been generated. Feed it to a visual model\n" +
                "  or review the screenshots manually against the design brief.\n",
            ),
          );
        }

        // Print scores
        console.log(chalk.bold("  Scores:\n"));
        for (const score of critique.scores) {
          const bar =
            score.score > 0
              ? chalk.green("|".repeat(score.score)) +
                chalk.gray("|".repeat(10 - score.score))
              : chalk.gray("|".repeat(10));
          console.log(
            `    ${score.dimension.padEnd(24)} ${bar}  ${score.score}/10`,
          );
          if (
            score.observation !== "Not yet evaluated — pending review" &&
            score.observation !== "Manual review required"
          ) {
            console.log(
              chalk.gray(`    ${"".padEnd(24)} ${score.observation}`),
            );
          }
        }

        console.log(
          `\n  Overall: ${chalk.bold(String(critique.overallScore))}/10`,
        );
        console.log(`  Summary: ${chalk.gray(critique.summary)}`);

        if (critique.improvements.length > 0) {
          console.log(chalk.bold("\n  Improvements:\n"));
          for (const imp of critique.improvements) {
            console.log(chalk.yellow(`    - ${imp}`));
          }
        }

        if (critique.strengths.length > 0) {
          console.log(chalk.bold("\n  Strengths:\n"));
          for (const s of critique.strengths) {
            console.log(chalk.green(`    - ${s}`));
          }
        }

        console.log(chalk.cyan(`\n  Saved: ${saved}\n`));
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`critique failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });
}
