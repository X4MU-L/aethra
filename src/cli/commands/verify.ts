/**
 * `aethra verify` — run verification against a plan's acceptance criteria.
 * Accepts either a plan JSON path OR --task <id> to look up the task's plan.
 */

import type { Command } from 'commander';
import path from 'path';
import chalk from 'chalk';
import crypto from 'crypto';
import { resolveClientWorkspace } from '../../config/manager.js';
import { runAudit } from '../../audit/runner.js';
import { readJson, writeJson, ensureDir, pathExists } from '../../engine/fs.js';
import { findTaskByPrefix, transitionTask } from '../../engine/tasks.js';
import { runTestSuite, type TestRunResult } from '../../engine/testrunner.js';
import { logger } from '../../core/logger.js';
import { toAethraError } from '../../core/errors.js';
import type { ImplementationPlan } from '../../core/schemas.js';

export function registerVerifyCommand(program: Command): void {
  program
    .command('verify')
    .description('Verify implementation against plan acceptance criteria')
    .argument('[plan]', 'Plan JSON file to verify against')
    .option('--client <slug>', 'Specify client by slug')
    .option('--task <id>', 'Task ID to verify (looks up the plan automatically)')
    .option('--run-tests [dir]', 'Run the test suite in this directory (or config.repositoryPath) and record pass/fail')
    .option('--json', 'Output results as JSON')
    .action(async (planArg: string | undefined, opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.opts()?.client;

      const jsonMode = opts.json || cmd.parent?.opts()?.json;

      try {
        const { config, workspacePath } = await resolveClientWorkspace(clientSlug);

        if (!jsonMode) {
          console.log(chalk.bold.blue(`\n  Verify — ${config.name}\n`));
        }

        // ─── Resolve plan: --task <id> OR positional plan file path ──────────
        let plan: ImplementationPlan | null = null;
        let resolvedTaskId: string | undefined;

        if (opts.task) {
          // Look up task → plan path
          const taskRecord = await findTaskByPrefix(workspacePath, opts.task as string);
          if (!taskRecord) {
            logger.error(`Task not found: ${opts.task}`);
            process.exit(1);
          }
          resolvedTaskId = taskRecord.id;
          if (await pathExists(taskRecord.planPath)) {
            plan = await readJson<ImplementationPlan>(taskRecord.planPath);
            if (!jsonMode) {
              console.log(chalk.gray(`  Task: ${taskRecord.id.slice(0, 8)} — ${taskRecord.title}`));
              console.log(chalk.gray(`  Plan: ${plan.title}\n`));
            }
          }
        } else if (planArg) {
          const planPath = path.isAbsolute(planArg)
            ? planArg
            : path.resolve(process.cwd(), planArg);

          const jsonPath = planPath.endsWith('.json')
            ? planPath
            : planPath.replace(/\.md$/, '.json');

          if (await pathExists(jsonPath)) {
            plan = await readJson<ImplementationPlan>(jsonPath);
            if (!jsonMode) {
              console.log(chalk.gray(`  Verifying against plan: ${plan.title}\n`));
            }
          }
        }

        // ─── Optional: run the test suite ─────────────────────────────────────
        let testRun: TestRunResult | undefined;

        if (opts.runTests !== undefined) {
          // --run-tests may be a boolean (flag with no value) or a string (explicit dir)
          const testDir =
            typeof opts.runTests === 'string'
              ? opts.runTests
              : (config.repositoryPath ?? process.cwd());

          if (!jsonMode) {
            console.log(chalk.gray(`  Running test suite in: ${testDir}\n`));
          }

          testRun = await runTestSuite(testDir, { cwd: testDir });

          if (!jsonMode) {
            const icon = testRun.passed ? chalk.green('✓') : chalk.red('✗');
            console.log(`  ${icon} Tests: ${testRun.passedCount} passed, ${testRun.failedCount} failed`);
            if (testRun.parseError) {
              console.log(chalk.yellow(`  ⚠ ${testRun.parseError}`));
            }
            console.log();
          }
        }

        // Run a verification audit
        logger.info('Running verification audit...');
        const verifyAudit = await runAudit(config, workspacePath, {
          type: 'refresh',
          maxPages: 5,
          runLighthouseAudit: plan !== null,
          captureScreenshots: true,
        });

        const verificationResults: Array<{
          criterion: string;
          passed: boolean | null;
          notes: string;
        }> = [];

        if (plan) {
          for (const ac of plan.acceptanceCriteria) {
            // Auto-verify what we can from the audit
            let passed: boolean | null = null;
            let notes = 'Manual verification required';

            if (ac.category === 'performance' && verifyAudit.artifactManifest.some((a) => a.type === 'lighthouse')) {
              passed = null; // Would need baseline comparison
              notes = 'Lighthouse report generated. Compare with baseline.';
            }

            if (ac.category === 'visual' && verifyAudit.artifactManifest.some((a) => a.type === 'screenshot')) {
              passed = null; // Visual comparison requires human or tool
              notes = 'Screenshots captured. Review for visual regressions.';
            }

            verificationResults.push({
              criterion: ac.description,
              passed,
              notes,
            });
          }
        }

        // Save verification record
        const verifyDir = path.join(workspacePath, 'evidence', 'browser-tests');
        await ensureDir(verifyDir);
        const verifyId = crypto.randomBytes(8).toString('hex');
        const verifyRecord = {
          id: verifyId,
          timestamp: new Date().toISOString(),
          taskId: resolvedTaskId,
          planId: plan?.id,
          auditId: verifyAudit.id,
          results: verificationResults,
          limitations: verifyAudit.limitations,
          errors: verifyAudit.errors,
          testRun: testRun
            ? {
                command: testRun.command,
                workingDir: testRun.workingDir,
                exitCode: testRun.exitCode,
                passed: testRun.passed,
                passedCount: testRun.passedCount,
                failedCount: testRun.failedCount,
                skippedCount: testRun.skippedCount,
                duration: testRun.duration,
              }
            : undefined,
        };
        const verifyRecordPath = path.join(verifyDir, `verify-${verifyId}.json`);
        await writeJson(verifyRecordPath, verifyRecord);

        // Transition task: verifying → completed (or leave at verifying if ACs need human review)
        if (resolvedTaskId) {
          // Tests failing is a definitive failure — push back to in-progress
          const testsFailed = testRun !== undefined && !testRun.passed;
          const anyDefinitelyFailed =
            testsFailed || verificationResults.some((r) => r.passed === false);
          const allPassed =
            !testsFailed && verificationResults.every((r) => r.passed === true);
          const newStatus = anyDefinitelyFailed ? 'in-progress' : allPassed ? 'completed' : 'verifying';

          await transitionTask(workspacePath, resolvedTaskId, newStatus, {
            verificationId: verifyId,
          });

          if (!jsonMode) {
            if (newStatus === 'completed') {
              console.log(chalk.bold.green('\n  ✓ Task marked as completed.\n'));
            } else if (newStatus === 'in-progress') {
              console.log(chalk.bold.red('\n  ✗ Acceptance criteria failed — task moved back to in-progress.\n'));
            } else {
              console.log(chalk.bold.yellow('\n  Verification needs manual review — task status: verifying.\n'));
            }
          }
        }

        if (jsonMode) {
          console.log(JSON.stringify(verifyRecord, null, 2));
          return;
        }

        console.log(chalk.bold.green(`\n  Verification complete\n`));
        console.log(`  Audit: ${verifyAudit.id}`);
        console.log(`  Status: ${verifyAudit.status}`);
        console.log(`  Artifacts: ${verifyAudit.artifactManifest.length}`);

        if (verificationResults.length > 0) {
          console.log(chalk.bold('\n  Acceptance criteria:\n'));
          for (const result of verificationResults) {
            const icon =
              result.passed === true
                ? chalk.green('✓')
                : result.passed === false
                ? chalk.red('✗')
                : chalk.yellow('?');
            console.log(`  ${icon} ${result.criterion}`);
            console.log(chalk.gray(`      ${result.notes}`));
          }
        }

        if (testRun) {
          console.log(chalk.bold('\n  Test suite:\n'));
          const icon = testRun.passed ? chalk.green('✓') : chalk.red('✗');
          console.log(`  ${icon} ${testRun.passedCount} passed, ${testRun.failedCount} failed  (exit ${testRun.exitCode})`);
          if (!testRun.passed && testRun.files.length > 0) {
            for (const f of testRun.files) {
              if (f.status === 'failed') {
                for (const c of f.cases) {
                  if (c.status === 'failed') {
                    console.log(chalk.red(`    ✗ ${c.fullName}`));
                    if (c.failureMessages[0]) {
                      console.log(chalk.gray(`      ${c.failureMessages[0].split('\n')[0]}`));
                    }
                  }
                }
              }
            }
          }
        }

        if (verifyAudit.limitations.length > 0) {
          console.log(chalk.bold('\n  Limitations:\n'));
          for (const lim of verifyAudit.limitations) console.log(chalk.yellow(`  ⚠ ${lim}`));
        }

        console.log(chalk.cyan(`\n  Verification record: ${path.join(verifyDir, `verify-${verifyRecord.id}.json`)}\n`));
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`verify failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });
}
