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
import { findTaskByPrefix } from "../../engine/tasks.js";
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
      if (isNaN(count) || count < 1 || count > 50) {
        logger.error(
          `Count must be an integer between 1 and 50 (received "${opts.count}")`,
        );
        process.exit(1);
      }

      let seed: number | undefined;
      if (opts.seed !== undefined) {
        seed = parseInt(opts.seed, 10);
        if (isNaN(seed)) {
          logger.error(`Seed must be an integer (received "${opts.seed}")`);
          process.exit(1);
        }
      }

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

        if (directions.length === 0) {
          console.log(
            chalk.yellow(
              `\n  ⚠ No design directions could be generated for "${task}".\n` +
                "    All candidates were eliminated due to prohibitive client constraints.\n",
            ),
          );
          return;
        }

        console.log(
          chalk.bold.blue(
            `\n  Design Directions — ${directions.length} generated\n`,
          ),
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
    .option("--run <run-id>", "Specific audit run ID to pull screenshots from")
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

        // Fetch task description and title if available
        let taskDescription = `Task ${taskId}`;
        try {
          const taskRecord = await findTaskByPrefix(workspacePath, taskId);
          if (taskRecord) {
            taskDescription = `${taskRecord.title}${taskRecord.notes ? `: ${taskRecord.notes}` : ""}`;
          }
        } catch {
          // Fall back to taskId string
        }

        // Load design brief
        const brief = await loadDesignBrief(workspacePath, taskId);
        if (!brief) {
          logger.warn(
            `No design brief found for task ${taskId}. Critique will proceed without brief context.`,
          );
        }

        // Look for screenshots with explicit run provenance
        const screenshotsDir = path.join(
          workspacePath,
          "evidence",
          "screenshots",
        );
        const screenshotPaths: string[] = [];
        if (await pathExists(screenshotsDir)) {
          const { promises: fs } = await import("fs");

          if (opts.run) {
            if (!/^[a-zA-Z0-9_-]+$/.test(opts.run)) {
              logger.error(
                `Invalid run identifier "${opts.run}". Must contain only alphanumeric characters, dashes, and underscores.`,
              );
              process.exit(1);
            }

            const runName = opts.run.startsWith("run-")
              ? opts.run
              : `run-${opts.run}`;
            const runDir = path.join(screenshotsDir, runName);
            const resolvedRunDir = path.resolve(runDir);
            const resolvedScreenshotsDir = path.resolve(screenshotsDir);
            const rel = path.relative(resolvedScreenshotsDir, resolvedRunDir);
            const isContained =
              rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);

            if (!isContained || !(await pathExists(runDir))) {
              logger.warn(`Screenshot directory for run not found: ${runDir}`);
            } else {
              const files = await fs.readdir(runDir);
              for (const f of files) {
                if (/\.(png|jpg|jpeg|webp)$/i.test(f)) {
                  screenshotPaths.push(path.join(runDir, f));
                }
              }
              logger.info(`Using screenshots from specified run: ${runName}`);
            }
          } else {
            // Find latest run subdirectory by modified time to avoid mixing historical audits
            const entries = await fs.readdir(screenshotsDir, {
              withFileTypes: true,
            });
            const subdirs = entries.filter((e) => e.isDirectory());
            if (subdirs.length > 0) {
              const dirStats = await Promise.all(
                subdirs.map(async (d) => {
                  const s = await fs.stat(path.join(screenshotsDir, d.name));
                  return { name: d.name, mtime: s.mtimeMs };
                }),
              );
              dirStats.sort((a, b) => b.mtime - a.mtime);
              const latestRunDir = path.join(
                screenshotsDir,
                dirStats[0]!.name,
              );
              const files = await fs.readdir(latestRunDir);
              for (const f of files) {
                if (/\.(png|jpg|jpeg|webp)$/i.test(f)) {
                  screenshotPaths.push(path.join(latestRunDir, f));
                }
              }
              logger.info(
                `Using screenshots from latest audit run: ${dirStats[0]!.name}`,
              );
            }

            // Fallback: check root screenshots dir
            if (screenshotPaths.length === 0) {
              for (const entry of entries) {
                if (
                  entry.isFile() &&
                  /\.(png|jpg|jpeg|webp)$/i.test(entry.name)
                ) {
                  screenshotPaths.push(path.join(screenshotsDir, entry.name));
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
        console.log(chalk.gray(`  Brief: ${brief ? brief.id : "none"}`));
        console.log(chalk.gray(`  Task: ${taskDescription}\n`));

        const critique = await evaluateDesign({
          screenshotPaths,
          designBrief: brief ?? undefined,
          taskDescription,
        });

        // Set taskId for persistence and lookup
        critique.taskId = taskId;

        // Save critique
        const saved = await saveCritique(workspacePath, critique);

        // Show review status and scores honestly
        if (critique.reviewStatus === "pending" || critique.overallScore == null) {
          console.log(
            chalk.yellow(
              "  Status: Pending review (manual / multimodal review required)\n",
            ),
          );
          console.log(
            chalk.gray(
              "  Evaluation has not been performed by an automated multimodal model.\n" +
                "  No numeric scores are assigned. A critique prompt has been generated for external evaluation.\n",
            ),
          );
        } else {
          console.log(chalk.bold("  Scores:\n"));
          for (const score of critique.scores) {
            const sc = score.score ?? 0;
            const bar =
              sc > 0
                ? chalk.green("|".repeat(sc)) +
                  chalk.gray("|".repeat(10 - sc))
                : chalk.gray("|".repeat(10));
            console.log(
              `    ${score.dimension.padEnd(24)} ${bar}  ${sc}/10`,
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
        }
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
