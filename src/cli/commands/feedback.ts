/**
 * `aethra feedback` — visual feedback lifecycle management.
 * Import, triage, plan, and resolve visual feedback from providers.
 */

import type { Command } from "commander";
import chalk from "chalk";
import { resolveClientWorkspace } from "../../config/manager.js";
import {
  listFeedback,
  loadFeedback,
  saveFeedback,
  importFeedback,
  linkFeedbackToTask,
  resolveFeedback,
  createPlanFromFeedback,
  getAllProviderStatus,
} from "../../visual-feedback/manager.js";
import { getProvider } from "../../visual-feedback/providers/registry.js";
import type { VisualFeedbackProvider } from "../../visual-feedback/providers/base.js";
import { logger } from "../../core/logger.js";
import { toAethraError } from "../../core/errors.js";
import {
  getDb,
  dbGetSessionsForClient,
  dbSaveSessionMapping,
  dbRemoveSessionMapping,
  dbFindFeedbackByProviderAnnotation,
} from "../../engine/db.js";

const STATUS_ICON: Record<string, string> = {
  pending: chalk.yellow("?"),
  triaged: chalk.cyan("~"),
  linked: chalk.blue(">"),
  "in-progress": chalk.yellow(">"),
  resolved: chalk.green("\u2713"),
  dismissed: chalk.red("\u2717"),
};

export function registerFeedbackCommand(program: Command): void {
  const feedback = program
    .command("feedback")
    .description("Visual feedback lifecycle management");

  // -- feedback status -------------------------------------------------------
  feedback
    .command("status")
    .description("Show provider availability and pending feedback count")
    .option("--client <slug>", "Specify client by slug")
    .action(async (opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;

      try {
        const { config, workspacePath } =
          await resolveClientWorkspace(clientSlug);
        const providers = await getAllProviderStatus();
        const pending = await listFeedback(workspacePath, {
          status: "pending",
        });

        console.log(chalk.bold.blue(`\n  Feedback Status — ${config.name}\n`));

        console.log(chalk.bold("  Providers:\n"));
        for (const p of providers) {
          const icon = p.status.available
            ? chalk.green("\u2713")
            : chalk.red("\u2717");
          const connLabel = p.status.connected
            ? chalk.green("connected")
            : chalk.gray("disconnected");
          console.log(`  ${icon}  ${chalk.bold(p.name)}  ${connLabel}`);
          if (p.status.version) {
            console.log(chalk.gray(`        Version: ${p.status.version}`));
          }
          if (p.status.error) {
            console.log(chalk.red(`        Error: ${p.status.error}`));
          }
        }

        console.log();
        console.log(
          `  Pending feedback: ${chalk.bold.yellow(String(pending.length))}`,
        );
        console.log(
          chalk.gray(
            `  Default provider: ${config.visualFeedback?.defaultProvider ?? "manual"}`,
          ),
        );
        console.log();
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`feedback status failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });

  // -- feedback import -------------------------------------------------------
  feedback
    .command("import")
    .description("Import pending annotations from a provider")
    .option("--provider <name>", "Provider to import from")
    .option("--client <slug>", "Specify client by slug")
    .action(async (opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;

      try {
        const { config, workspacePath, slug } =
          await resolveClientWorkspace(clientSlug);
        const providerName: string =
          opts.provider ?? config.visualFeedback?.defaultProvider ?? "manual";

        console.log(chalk.bold.blue(`\n  Import Feedback — ${config.name}\n`));
        console.log(chalk.gray(`  Provider: ${providerName}\n`));

        const result = await importFeedback(workspacePath, slug, providerName);

        if (result.imported.length === 0) {
          console.log(chalk.gray("  No feedback annotations found.\n"));
        } else if (result.newCount === 0 && result.updatedCount === 0) {
          console.log(
            chalk.gray(
              `  All ${result.imported.length} annotation(s) are already imported and up-to-date.\n`,
            ),
          );
        } else {
          console.log(
            chalk.green(
              `  ${result.newCount} new item(s) imported, ${result.updatedCount} updated (${result.unchangedCount} unchanged):\n`,
            ),
          );
          for (const item of result.imported) {
            console.log(
              `  ${STATUS_ICON[item.status] ?? "?"}  ${chalk.bold(item.id.slice(0, 8))}  ${item.comment.slice(0, 60)}`,
            );
          }
          console.log();
        }

        if (result.errors.length > 0) {
          console.log(chalk.red(`  ${result.errors.length} error(s):\n`));
          for (const err of result.errors) {
            console.log(chalk.red(`    - ${err}`));
          }
          console.log();
        }
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`feedback import failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });

  // -- feedback list ---------------------------------------------------------
  feedback
    .command("list")
    .alias("ls")
    .description("List feedback items")
    .option(
      "--status <status>",
      "Filter by status (pending, triaged, linked, resolved, dismissed)",
    )
    .option("--page <url>", "Filter by page URL")
    .option("--client <slug>", "Specify client by slug")
    .option("--json", "Output as JSON")
    .action(async (opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;
      const jsonMode = opts.json || cmd.parent?.parent?.opts()?.json;

      try {
        const { config, workspacePath } =
          await resolveClientWorkspace(clientSlug);
        const items = await listFeedback(workspacePath, {
          status: opts.status,
          pageUrl: opts.page,
        });

        if (jsonMode) {
          console.log(JSON.stringify(items, null, 2));
          return;
        }

        console.log(chalk.bold.blue(`\n  Feedback — ${config.name}\n`));

        if (items.length === 0) {
          const hint = opts.status
            ? `No feedback with status "${opts.status}".`
            : "No feedback items yet. Run: aethra feedback import";
          console.log(chalk.gray(`  ${hint}\n`));
          return;
        }

        for (const item of items) {
          const icon = STATUS_ICON[item.status] ?? chalk.gray("?");
          const kindLabel = chalk.gray(`[${item.kind}/${item.severity}]`);
          console.log(
            `  ${icon}  ${chalk.bold(item.id.slice(0, 8))}  ${kindLabel}  ${item.comment.slice(0, 60)}`,
          );
          console.log(chalk.gray(`        Page: ${item.pageUrl}`));
          if (item.taskId) {
            console.log(chalk.gray(`        Task: ${item.taskId.slice(0, 8)}`));
          }
          console.log();
        }

        const statusCounts = items.reduce<Record<string, number>>(
          (acc, item) => {
            acc[item.status] = (acc[item.status] ?? 0) + 1;
            return acc;
          },
          {},
        );
        const summary = Object.entries(statusCounts)
          .map(([s, n]) => `${n} ${s}`)
          .join(", ");
        console.log(
          chalk.gray(`  Total: ${items.length} item(s) — ${summary}\n`),
        );
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`feedback list failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });

  // -- feedback show ---------------------------------------------------------
  feedback
    .command("show <id>")
    .description("Show detailed feedback item")
    .option("--client <slug>", "Specify client by slug")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;
      const jsonMode = opts.json || cmd.parent?.parent?.opts()?.json;

      try {
        const { workspacePath } = await resolveClientWorkspace(clientSlug);
        const item = await loadFeedback(workspacePath, id);

        if (!item) {
          logger.error(`Feedback not found: ${id}`);
          process.exit(1);
        }

        if (jsonMode) {
          console.log(JSON.stringify(item, null, 2));
          return;
        }

        const icon = STATUS_ICON[item.status] ?? "?";
        console.log(chalk.bold.blue(`\n  Feedback ${item.id.slice(0, 8)}\n`));
        console.log(`  ${icon}  ${chalk.bold(item.comment)}`);
        console.log();
        console.log(`  Status:     ${item.status}`);
        console.log(`  ID:         ${item.id}`);
        console.log(`  Kind:       ${item.kind}`);
        console.log(`  Severity:   ${item.severity}`);
        console.log(`  Intent:     ${item.intent}`);
        console.log(`  Provider:   ${item.provider}`);
        console.log(`  Page:       ${item.pageUrl}`);
        console.log(`  Created:    ${item.createdAt}`);

        if (item.viewport) {
          console.log(
            `  Viewport:   ${item.viewport.width}x${item.viewport.height}`,
          );
        }

        // Element context
        if (item.elementTag || item.elementSelector || item.boundingBox) {
          console.log(chalk.bold("\n  Element context:\n"));
          if (item.elementTag) console.log(`  Tag:        ${item.elementTag}`);
          if (item.elementSelector)
            console.log(`  Selector:   ${item.elementSelector}`);
          if (item.cssClasses && item.cssClasses.length > 0) {
            console.log(`  Classes:    ${item.cssClasses.join(", ")}`);
          }
          if (item.boundingBox) {
            const bb = item.boundingBox;
            console.log(
              `  Bounding:   x=${bb.x} y=${bb.y} w=${bb.width} h=${bb.height}`,
            );
          }
        }

        // Code context
        if (
          item.sourceFile ||
          (item.componentTree && item.componentTree.length > 0)
        ) {
          console.log(chalk.bold("\n  Code context:\n"));
          if (item.sourceFile) console.log(`  Source:     ${item.sourceFile}`);
          if (item.componentTree && item.componentTree.length > 0) {
            console.log(`  Components: ${item.componentTree.join(" > ")}`);
          }
        }

        // Accessibility
        if (item.accessibilityContext) {
          const ac = item.accessibilityContext;
          console.log(chalk.bold("\n  Accessibility:\n"));
          if (ac.role) console.log(`  Role:       ${ac.role}`);
          if (ac.ariaLabel) console.log(`  Aria label: ${ac.ariaLabel}`);
          if (ac.contrast != null) console.log(`  Contrast:   ${ac.contrast}`);
          if (ac.violations && ac.violations.length > 0) {
            for (const v of ac.violations) {
              console.log(chalk.red(`  Violation:  ${v}`));
            }
          }
        }

        // Evidence
        if (item.screenshotReference) {
          console.log(chalk.bold("\n  Evidence:\n"));
          console.log(`  Screenshot: ${item.screenshotReference}`);
        }

        // Resolution
        if (item.resolutionSummary) {
          console.log(chalk.bold("\n  Resolution:\n"));
          console.log(`  ${item.resolutionSummary}`);
        }

        // Cross-references
        if (item.taskId) console.log(`\n  Task:       ${item.taskId}`);
        if (item.relatedFindingIds.length > 0) {
          console.log(`  Findings:   ${item.relatedFindingIds.join(", ")}`);
        }
        if (item.relatedFeedbackIds.length > 0) {
          console.log(`  Related:    ${item.relatedFeedbackIds.join(", ")}`);
        }

        console.log();
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`feedback show failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });

  // -- feedback plan ---------------------------------------------------------
  feedback
    .command("plan [ids...]")
    .description("Create an implementation plan from feedback items")
    .option("--pending", "Use all pending feedback items")
    .option("--client <slug>", "Specify client by slug")
    .action(async (ids: string[], opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;

      try {
        const { config, workspacePath, slug } =
          await resolveClientWorkspace(clientSlug);

        let items;
        if (opts.pending) {
          items = await listFeedback(workspacePath, { status: "pending" });
        } else if (ids.length > 0) {
          const loaded = await Promise.all(
            ids.map((id) => loadFeedback(workspacePath, id)),
          );
          const missing = ids.filter((_, i) => !loaded[i]);
          if (missing.length > 0) {
            logger.error(`Feedback not found: ${missing.join(", ")}`);
            process.exit(1);
          }
          items = loaded.filter(
            (item): item is NonNullable<typeof item> => item !== null,
          );
        } else {
          logger.error(
            "Provide feedback IDs or use --pending to select all pending items.",
          );
          process.exit(1);
        }

        if (items.length === 0) {
          console.log(chalk.yellow("\n  No feedback items to plan.\n"));
          return;
        }

        console.log(chalk.bold.blue(`\n  Creating plan — ${config.name}\n`));
        console.log(chalk.gray(`  Feedback items: ${items.length}\n`));

        const { plan, taskRecord } = await createPlanFromFeedback(
          workspacePath,
          items,
          slug,
        );

        console.log(chalk.bold.green(`  \u2713 Plan created\n`));
        console.log(`  Plan:   ${plan.id}`);
        console.log(`  Title:  ${plan.title}`);
        console.log(
          `  Task:   ${taskRecord.id.slice(0, 8)} — ${taskRecord.title}`,
        );
        console.log(`  Status: ${plan.status}`);
        console.log();
        console.log(
          chalk.gray(
            `  Next: review the plan, then run: aethra task approve ${taskRecord.id.slice(0, 8)}\n`,
          ),
        );
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`feedback plan failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });

  // -- feedback attach -------------------------------------------------------
  feedback
    .command("attach <feedback-id>")
    .description("Link feedback to an existing task")
    .requiredOption("--task <task-id>", "Task ID to link to")
    .option("--client <slug>", "Specify client by slug")
    .action(async (feedbackId: string, opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;

      try {
        const { workspacePath } = await resolveClientWorkspace(clientSlug);
        const updated = await linkFeedbackToTask(
          workspacePath,
          feedbackId,
          opts.task,
        );

        console.log(chalk.bold.green(`\n  \u2713 Feedback linked\n`));
        console.log(`  Feedback: ${updated.id.slice(0, 8)}`);
        console.log(`  Task:     ${opts.task}`);
        console.log(`  Status:   ${updated.status}`);
        console.log();
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`feedback attach failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });

  // -- feedback resolve ------------------------------------------------------
  feedback
    .command("resolve <id>")
    .description("Mark feedback as resolved")
    .requiredOption("--summary <text>", "Resolution summary")
    .option("--client <slug>", "Specify client by slug")
    .action(async (id: string, opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;

      try {
        const { workspacePath } = await resolveClientWorkspace(clientSlug);
        const updated = await resolveFeedback(workspacePath, id, opts.summary);

        console.log(chalk.bold.green(`\n  \u2713 Feedback resolved\n`));
        console.log(`  Feedback: ${updated.id.slice(0, 8)}`);
        console.log(`  Status:   ${updated.status}`);
        console.log(`  Summary:  ${opts.summary}`);
        if (updated.upstreamSynced === false) {
          console.log(
            chalk.yellow(
              `  ⚠ Upstream sync failed: ${updated.upstreamError ?? "unknown error"}`,
            ),
          );
        }
        console.log();
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`feedback resolve failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });

  // -- feedback watch --------------------------------------------------------
  feedback
    .command("setup-toolbar")
    .description(
      "Check toolbar compatibility and print setup instructions for the client project",
    )
    .option("--client <slug>", "Specify client by slug")
    .option("--port <port>", "Agentation server port", "4747")
    .option("--session <id>", "Specific session ID to verify and configure")
    .action(async (opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;

      try {
        const { config, workspacePath } = await resolveClientWorkspace(clientSlug);
        const port = parseInt(opts.port, 10);

        console.log(
          chalk.bold.blue(`\n  Toolbar Setup Check — ${config.name}\n`),
        );

        // Check platform compatibility
        const platform = config.platform ?? "unknown";
        const compatible = ["react", "nextjs"].includes(platform);

        console.log(chalk.gray(`  Platform: ${platform}`));
        console.log(
          compatible
            ? chalk.green("  ✓ Compatible with Agentation toolbar")
            : chalk.yellow(
                "  ⚠ Agentation toolbar requires React or Next.js. Use manual feedback instead.",
              ),
        );

        if (!compatible) {
          console.log(
            chalk.gray(
              "\n  For non-React projects, use:\n    aethra feedback watch --provider manual\n",
            ),
          );
          return;
        }

        // Resolve explicit session mapping if one already exists
        const db = getDb(workspacePath);
        let activeSessionId: string | null = null;
        let sessionNote: string | null = null;

        const agProvider = getProvider("agentation") as
          | (VisualFeedbackProvider & {
              validateSession?: (id: string) => Promise<unknown>;
            })
          | undefined;

        if (opts.session) {
          // Explicit session option specified by user
          if (agProvider && typeof agProvider.validateSession === "function") {
            const v = (await agProvider.validateSession(opts.session)) as
              | { status: string; reason?: string }
              | boolean;
            const status =
              typeof v === "object" && v !== null
                ? v.status
                : v
                  ? "valid"
                  : "not-found";
            if (status === "valid") {
              activeSessionId = opts.session;
            } else if (status === "not-found") {
              sessionNote = `Specified session "${opts.session}" was not found upstream (HTTP 404).`;
            } else {
              const reason = typeof v === "object" && v?.reason ? v.reason : status;
              sessionNote = `Specified session "${opts.session}" could not be confirmed upstream (${reason}).`;
            }
          } else {
            activeSessionId = opts.session;
          }
        } else {
          // Documented selection policy: check most recently mapped session first
          const existingSessions = dbGetSessionsForClient(db, config.slug);
          for (const existingId of existingSessions) {
            if (agProvider && typeof agProvider.validateSession === "function") {
              const v = (await agProvider.validateSession(existingId)) as
                | { status: string; reason?: string }
                | boolean;
              const status =
                typeof v === "object" && v !== null
                  ? v.status
                  : v
                    ? "valid"
                    : "not-found";
              if (status === "valid") {
                activeSessionId = existingId;
                if (existingSessions.length > 1) {
                  sessionNote = `Using most recent verified mapped session "${activeSessionId}" (${existingSessions.length} mapped sessions; use --session <id> to specify another).`;
                }
                break;
              } else if (status === "not-found") {
                logger.warn(
                  `Mapped session "${existingId}" is confirmed stale (HTTP 404 upstream); cleaning up.`,
                );
                dbRemoveSessionMapping(db, existingId, config.slug, workspacePath);
              } else {
                const reason = typeof v === "object" && v?.reason ? v.reason : status;
                sessionNote = `Mapped session "${existingId}" cannot be verified upstream (${reason}). Start the watcher or check server connectivity.`;
                // Preserve mapping on transient error
              }
            } else {
              activeSessionId = existingId;
              break;
            }
          }
        }

        // Check if repository path is configured
        const repoPath = config.repositoryPath;
        if (!repoPath) {
          console.log(
            chalk.yellow("\n  ⚠ No repositoryPath configured in client.yaml."),
          );
          console.log(
            chalk.gray(
              "  Set it to enable automatic detection of your app entry point.\n",
            ),
          );
        }

        // Check if agentation package is already installed in the client project
        let alreadyInstalled = false;
        if (repoPath) {
          const { pathExists } = await import("../../engine/fs.js");
          const pkgPath = `${repoPath}/node_modules/agentation/package.json`;
          alreadyInstalled = await pathExists(pkgPath);
        }

        console.log(
          alreadyInstalled
            ? chalk.green("  ✓ agentation package detected in client project")
            : chalk.gray(
                "  ○ agentation package not detected in client project",
              ),
        );

        // Print setup instructions
        console.log(chalk.bold("\n  Setup Instructions:\n"));

        if (!alreadyInstalled) {
          console.log(
            chalk.cyan("  1. Install the toolbar in your project:\n"),
          );
          console.log(
            chalk.gray(
              `     cd ${repoPath ?? "<project-root>"}\n     npm install agentation -D\n`,
            ),
          );
        }

        console.log(
          chalk.cyan(
            `  ${alreadyInstalled ? "1" : "2"}. Add the toolbar to your app root:\n`,
          ),
        );

        if (activeSessionId) {
          console.log(
            chalk.gray(
              `     import { Agentation } from "agentation";\n\n     function App() {\n       return (\n         <>\n           <YourApp />\n           {process.env.NODE_ENV === "development" && (\n             <Agentation\n               endpoint="http://localhost:${port}"\n               sessionId="${activeSessionId}"\n             />\n           )}\n         </>\n       );\n     }\n`,
            ),
          );
          console.log(
            chalk.gray(
              `     (Using verified mapped session "${activeSessionId}" for client "${config.slug}")\n`,
            ),
          );
          if (sessionNote) {
            console.log(chalk.cyan(`     Note: ${sessionNote}\n`));
          }
        } else {
          console.log(
            chalk.gray(
              `     import { Agentation } from "agentation";\n\n     function App() {\n       return (\n         <>\n           <YourApp />\n           {process.env.NODE_ENV === "development" && (\n             <Agentation\n               endpoint="http://localhost:${port}"\n               // Once 'aethra feedback watch' runs, pass its provisioned sessionId:\n               // sessionId="<active-session-id>"\n               // Or dynamically register browser-created sessions:\n               // onSessionCreated={(sessionId: string) => {\n               //   // aethra feedback register-session <sessionId> --client ${config.slug}\n               // }}\n             />\n           )}\n         </>\n       );\n     }\n`,
            ),
          );
          console.log(
            chalk.yellow(
              `     Notice: ${sessionNote ?? `No active verified session found for client "${config.slug}".`}\n` +
              `     Run 'aethra feedback watch --provider agentation --client ${config.slug}'\n` +
              `     to start the server and provision a verified session, or register a browser session with 'register-session'.\n`,
            ),
          );
        }

        console.log(
          chalk.cyan(
            `  ${alreadyInstalled ? "2" : "3"}. Start the feedback server:\n`,
          ),
        );
        console.log(
          chalk.gray(
            `     aethra feedback watch --provider agentation --client ${config.slug}\n`,
          ),
        );

        console.log(
          chalk.cyan(
            `  ${alreadyInstalled ? "3" : "4"}. Open your app and click elements to annotate.\n`,
          ),
        );

        console.log(chalk.bold("  Alternative dynamic session registration:\n"));
        console.log(
          chalk.gray(
            `  If your toolbar initializes its own session via onSessionCreated, register it using:\n    aethra feedback register-session <session-id> --client ${config.slug}\n`,
          ),
        );

        console.log(chalk.bold("  Important:\n"));
        console.log(
          chalk.gray(
            "  • The toolbar only appears in development (NODE_ENV=development)",
          ),
        );
        console.log(chalk.gray("  • Never deploy the toolbar to production"));
        console.log(
          chalk.gray(
            `  • The server runs on localhost:${port} (loopback only)\n`,
          ),
        );
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`setup-toolbar failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });

  feedback
    .command("register-session <session-id>")
    .description(
      "Register an active toolbar session with the client workspace",
    )
    .option("--client <slug>", "Specify client by slug")
    .action(async (sessionId: string, opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;

      try {
        const { config, workspacePath } =
          await resolveClientWorkspace(clientSlug);

        // Verify session existence upstream before saving mapping
        const agProvider = getProvider("agentation") as
          | (VisualFeedbackProvider & {
              validateSession?: (id: string) => Promise<unknown>;
            })
          | undefined;

        if (!agProvider || typeof agProvider.validateSession !== "function") {
          logger.error(
            "Cannot register session: Agentation provider is unavailable to verify session upstream.",
          );
          process.exit(1);
        }

        const v = (await agProvider.validateSession(sessionId)) as
          | { status: string; reason?: string }
          | boolean;
        const status =
          typeof v === "object" && v !== null
            ? v.status
            : v
              ? "valid"
              : "not-found";

        if (status === "not-found") {
          logger.error(
            `Cannot register session: session "${sessionId}" does not exist on Agentation server (HTTP 404).`,
          );
          process.exit(1);
        } else if (status !== "valid") {
          const reason = typeof v === "object" && v?.reason ? v.reason : status;
          logger.error(
            `Cannot register session: upstream verification failed (${reason}). Start the Agentation server before registering.`,
          );
          process.exit(1);
        }

        const db = getDb(workspacePath);
        dbSaveSessionMapping(db, sessionId, config.slug, workspacePath);

        console.log(
          chalk.green(
            `\n  ✓ Verified upstream and registered session "${sessionId}" for client "${config.name}".\n`,
          ),
        );
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`register-session failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });

  feedback
    .command("watch")
    .description(
      "Watch for new feedback (real-time SSE for agentation, polling for others)",
    )
    .option("--provider <name>", "Provider to watch")
    .option("--interval <seconds>", "Polling interval in seconds", "10")
    .option("--port <port>", "Agentation server port", "4747")
    .option("--client <slug>", "Specify client by slug")
    .option("--session <id>", "Specific session ID to watch / bind")
    .option(
      "--new-session",
      "Force creation of a new upstream session instead of reusing existing",
    )
    .action(async (opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;

      try {
        const { config, workspacePath, slug } =
          await resolveClientWorkspace(clientSlug);
        const providerName: string =
          opts.provider ?? config.visualFeedback?.defaultProvider ?? "manual";
        const intervalMs = parseInt(opts.interval, 10) * 1000;

        console.log(
          chalk.bold.blue(`\n  Watching for feedback — ${config.name}\n`),
        );
        console.log(chalk.gray(`  Provider: ${providerName}`));

        const ora = (await import("ora")).default;
        let running = true;
        let totalImported = 0;

        if (providerName === "agentation") {
          // ── Agentation: real-time SSE + polling fallback ──────────────────
          const provider = getProvider("agentation");
          if (
            !provider ||
            !("startServer" in provider) ||
            !("subscribeToEvents" in provider)
          ) {
            logger.error(
              "Agentation provider not available. Install agentation-mcp.",
            );
            process.exit(1);
          }

          // Type-narrow to access Agentation-specific methods
          const agProvider = provider as typeof provider & {
            setContext: (wp: string) => void;
            startServer: (port: number) => Promise<void>;
            stopServer: () => Promise<void>;
            validateSession?: (sessionId: string) => Promise<boolean>;
            subscribeToEvents: (
              cb: (ann: Record<string, unknown>) => void | Promise<void>,
              clientSlug?: string,
              sessionId?: string,
            ) => Promise<void>;
          };

          const port = parseInt(opts.port, 10);
          console.log(chalk.gray(`  Port: ${port}`));
          console.log(chalk.gray(`  Fallback polling: ${opts.interval}s`));
          console.log(chalk.gray("  Press Ctrl+C to stop.\n"));

          agProvider.setContext(workspacePath);

          try {
            await agProvider.startServer(port);
            console.log(
              chalk.green(`  Agentation server started on port ${port}`),
            );
          } catch (err) {
            logger.error(
              `Failed to start Agentation server: ${(err as Error).message}`,
            );
            process.exit(1);
          }

          // Resolve safe local development URL (never use production URL for Agentation)
          const isLocal = (url?: string): boolean => {
            if (!url) return false;
            try {
              const h = new URL(url).hostname.toLowerCase();
              return (
                h === "localhost" ||
                h === "127.0.0.1" ||
                h === "::1" ||
                h.endsWith(".local") ||
                h.endsWith(".test") ||
                h.endsWith(".localhost")
              );
            } catch {
              return false;
            }
          };

          const pageUrl =
            (isLocal(config.localUrl) ? config.localUrl : undefined) ??
            (isLocal(config.primaryUrl) ? config.primaryUrl : undefined) ??
            "http://localhost:3000";

          let activeSessionId: string | null = null;
          const db = getDb(workspacePath);

          if (opts.session) {
            // User requested an explicit session
            if (agProvider && typeof agProvider.validateSession === "function") {
              const v = (await agProvider.validateSession(opts.session)) as
                | { status: string; reason?: string }
                | boolean;
              const status =
                typeof v === "object" && v !== null
                  ? v.status
                  : v
                    ? "valid"
                    : "not-found";
              if (status === "not-found") {
                logger.error(
                  `Specified session "${opts.session}" does not exist on Agentation server (HTTP 404).`,
                );
                await agProvider.stopServer().catch(() => {});
                process.exit(1);
              } else if (status !== "valid") {
                const reason =
                  typeof v === "object" && v?.reason ? v.reason : status;
                logger.error(
                  `Failed to validate specified session "${opts.session}" upstream: ${reason}`,
                );
                await agProvider.stopServer().catch(() => {});
                process.exit(1);
              }
            }
            try {
              dbSaveSessionMapping(db, opts.session, slug, workspacePath);
              activeSessionId = opts.session;
              logger.info(
                `Bound explicit session "${activeSessionId}" to client "${slug}"`,
              );
            } catch (mapErr) {
              logger.error(
                `Session mapping failed: ${(mapErr as Error).message}`,
              );
              await agProvider.stopServer().catch(() => {});
              process.exit(1);
            }
          } else if (!opts.newSession) {
            // Reuse existing valid mapped session if available
            const existingSessions = dbGetSessionsForClient(db, slug);
            let hasTransientErrors = false;
            for (const existingId of existingSessions) {
              if (agProvider && typeof agProvider.validateSession === "function") {
                const v = (await agProvider.validateSession(existingId)) as
                  | { status: string; reason?: string }
                  | boolean;
                const status =
                  typeof v === "object" && v !== null
                    ? v.status
                    : v
                      ? "valid"
                      : "not-found";
                if (status === "valid") {
                  activeSessionId = existingId;
                  logger.info(
                    `Reusing active mapped session "${activeSessionId}"`,
                  );
                  break;
                } else if (status === "not-found") {
                  logger.warn(
                    `Mapped session "${existingId}" is confirmed stale (HTTP 404 upstream); cleaning up.`,
                  );
                  dbRemoveSessionMapping(db, existingId, slug, workspacePath);
                } else {
                  hasTransientErrors = true;
                  const reason =
                    typeof v === "object" && v?.reason ? v.reason : status;
                  logger.warn(
                    `Upstream validation of mapped session "${existingId}" failed (${reason}); preserving mapping.`,
                  );
                }
              } else {
                activeSessionId = existingId;
                break;
              }
            }

            if (!activeSessionId && hasTransientErrors && existingSessions.length > 0) {
              logger.error(
                `Existing mapped sessions could not be confirmed upstream due to server or connection errors. Preserved mappings. Use --new-session to force creation of a new session.`,
              );
              await agProvider.stopServer().catch(() => {});
              process.exit(1);
            }
          }

          if (!activeSessionId) {
            // Create a real session on the upstream server
            const sessionResult = await provider.startSession({
              pageUrl,
              clientSlug: slug,
            });

            if (!sessionResult.success || !sessionResult.sessionId) {
              logger.error(
                `Failed to create Agentation session: ${sessionResult.error ?? "unknown error"}`,
              );
              await agProvider.stopServer().catch(() => {});
              process.exit(1);
            }

            activeSessionId = sessionResult.sessionId;
          }

          console.log(chalk.gray(`  Session: ${activeSessionId} → ${pageUrl}`));
          console.log(
            chalk.cyan(
              `  Toolbar connection: <Agentation endpoint="http://localhost:${port}" sessionId="${activeSessionId}" />\n`,
            ),
          );

          const spinner = ora({
            text: "Listening for annotations (real-time + polling fallback)...",
            color: "cyan",
          }).start();

          // Shutdown handler — stop server before exit
          const shutdown = (): void => {
            running = false;
            spinner.stop();
            agProvider.stopServer().catch(() => {});
            console.log(
              chalk.gray(
                `\n  Stopped. ${totalImported} item(s) imported total.\n`,
              ),
            );
            process.exit(0);
          };

          process.on("SIGINT", shutdown);
          process.on("SIGTERM", shutdown);

          // Subscribe to SSE events for real-time annotations with workspace isolation
          await agProvider.subscribeToEvents(async (rawAnnotation) => {
            try {
              const feedback = provider.normalize(
                rawAnnotation as { id: string; [key: string]: unknown },
                slug,
              );
              const currentDb = getDb(workspacePath);
              const existing = feedback.providerAnnotationId
                ? dbFindFeedbackByProviderAnnotation(
                    currentDb,
                    feedback.provider,
                    feedback.providerAnnotationId,
                    feedback.clientId,
                  )
                : null;

              if (existing) {
                feedback.id = existing.id;
                feedback.status = existing.status;
                feedback.taskId = existing.taskId;
                feedback.resolutionSummary = existing.resolutionSummary;
                if (
                  existing.relatedFindingIds?.length &&
                  (!feedback.relatedFindingIds ||
                    feedback.relatedFindingIds.length === 0)
                ) {
                  feedback.relatedFindingIds = existing.relatedFindingIds;
                }
                if (
                  existing.relatedFeedbackIds?.length &&
                  (!feedback.relatedFeedbackIds ||
                    feedback.relatedFeedbackIds.length === 0)
                ) {
                  feedback.relatedFeedbackIds = existing.relatedFeedbackIds;
                }
              }

              await saveFeedback(workspacePath, feedback);

              if (!existing) {
                totalImported++;
                spinner.stop();
                console.log(
                  chalk.green(
                    `  +1 annotation (real-time) — total new: ${totalImported}`,
                  ),
                );
                console.log(
                  chalk.gray(
                    `    ${feedback.id.slice(0, 8)}  ${feedback.comment.slice(0, 60)}`,
                  ),
                );
                spinner.start(
                  "Listening for annotations (real-time + polling fallback)...",
                );
              }
            } catch (err) {
              logger.warn(`SSE annotation error: ${(err as Error).message}`);
            }
          }, slug, activeSessionId);

          // Slower polling loop as safety net
          const fallbackIntervalMs = Math.max(intervalMs, 30000);
          while (running) {
            if (running) {
              await new Promise<void>((resolve) =>
                setTimeout(resolve, fallbackIntervalMs),
              );
            }
            if (!running) break;

            try {
              const result = await importFeedback(
                workspacePath,
                slug,
                providerName,
              );

              if (result.newCount > 0) {
                totalImported += result.newCount;
                spinner.stop();
                console.log(
                  chalk.green(
                    `  +${result.newCount} new item(s) via poll (total new: ${totalImported})`,
                  ),
                );
                for (const item of result.imported.slice(0, result.newCount)) {
                  console.log(
                    chalk.gray(
                      `    ${item.id.slice(0, 8)}  ${item.comment.slice(0, 60)}`,
                    ),
                  );
                }
                spinner.start(
                  "Listening for annotations (real-time + polling fallback)...",
                );
              }
            } catch (pollErr) {
              logger.warn(`Poll fallback error: ${(pollErr as Error).message}`);
            }
          }
        } else {
          // ── Other providers: polling only ──────────────────────────────────
          console.log(chalk.gray(`  Interval: ${opts.interval}s`));
          console.log(chalk.gray("  Press Ctrl+C to stop.\n"));

          const spinner = ora({
            text: "Polling for feedback...",
            color: "cyan",
          }).start();

          const shutdown = (): void => {
            running = false;
            spinner.stop();
            console.log(
              chalk.gray(
                `\n  Stopped. ${totalImported} item(s) imported total.\n`,
              ),
            );
            process.exit(0);
          };

          process.on("SIGINT", shutdown);
          process.on("SIGTERM", shutdown);

          while (running) {
            try {
              const result = await importFeedback(
                workspacePath,
                slug,
                providerName,
              );

              if (result.imported.length > 0) {
                totalImported += result.imported.length;
                spinner.stop();
                console.log(
                  chalk.green(
                    `  +${result.imported.length} new item(s) imported (total: ${totalImported})`,
                  ),
                );
                for (const item of result.imported) {
                  console.log(
                    chalk.gray(
                      `    ${item.id.slice(0, 8)}  ${item.comment.slice(0, 60)}`,
                    ),
                  );
                }
                spinner.start("Polling for feedback...");
              }

              if (result.errors.length > 0) {
                spinner.stop();
                for (const err of result.errors) {
                  console.log(chalk.red(`  Error: ${err}`));
                }
                spinner.start("Polling for feedback...");
              }
            } catch (pollErr) {
              spinner.stop();
              logger.warn(`Poll error: ${(pollErr as Error).message}`);
              spinner.start("Polling for feedback...");
            }

            // Wait for interval
            if (running) {
              await new Promise<void>((resolve) =>
                setTimeout(resolve, intervalMs),
              );
            }
          }
        }
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`feedback watch failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });

  // -- feedback add ----------------------------------------------------------
  feedback
    .command("add")
    .description("Add a visual feedback item directly to the active workspace")
    .requiredOption("--comment <text>", "Feedback comment / description")
    .option("--page <url>", "Page URL where feedback was observed")
    .option(
      "--kind <kind>",
      "Kind (bug, style, accessibility, content, enhancement, question, other)",
      "other",
    )
    .option(
      "--severity <sev>",
      "Severity (critical, high, medium, low)",
      "medium",
    )
    .option("--selector <sel>", "CSS selector of element")
    .option("--client <slug>", "Specify client by slug")
    .action(async (opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;

      try {
        const { config, workspacePath, slug } =
          await resolveClientWorkspace(clientSlug);
        const crypto = await import("crypto");
        const pageUrl =
          opts.page ??
          config.localUrl ??
          config.primaryUrl ??
          "http://localhost:3000";
        const feedbackId = crypto.randomBytes(8).toString("hex");

        const item = {
          id: feedbackId,
          provider: "manual",
          clientId: slug,
          pageUrl,
          comment: opts.comment,
          kind: opts.kind,
          intent: "investigate",
          severity: opts.severity,
          elementSelector: opts.selector,
          createdAt: new Date().toISOString(),
          status: "pending",
        };

        await saveFeedback(workspacePath, item as any);

        console.log(
          chalk.bold.green(`\n  \u2713 Manual feedback added — ${config.name}\n`),
        );
        console.log(`  ID:       ${feedbackId}`);
        console.log(`  Page:     ${pageUrl}`);
        console.log(`  Comment:  ${opts.comment}`);
        console.log(`  Kind:     ${opts.kind}`);
        console.log(`  Severity: ${opts.severity}`);
        console.log();
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`feedback add failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });
}
