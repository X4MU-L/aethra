/**
 * `aethra apply-fix <plan-or-task-id>` — apply an approved implementation plan.
 * Accepts either a plan file path OR a task ID (8+ char prefix).
 * Validates Git state, plan approval, and creates a feature branch.
 */

import type { Command } from 'commander';
import path from 'path';
import chalk from 'chalk';
import { resolveClientWorkspace } from '../../config/manager.js';
import { getGitStatus, createFeatureBranch } from '../../engine/git.js';
import { queryOutput } from '../../engine/subprocess.js';
import { readJson, pathExists } from '../../engine/fs.js';
import { findTaskByPrefix, transitionTask, updateTask } from '../../engine/tasks.js';
import { getDefaultAdapter } from '../../agents/registry.js';
import { selectSkillsForTask } from '../../engine/context.js';
import { logger } from '../../core/logger.js';
import { toAethraError, WorkspaceError } from '../../core/errors.js';
import type { ImplementationPlan } from '../../core/schemas.js';

export function registerApplyFixCommand(program: Command): void {
  program
    .command('apply-fix <plan-or-task-id>')
    .description('Apply an approved implementation plan (accepts task ID or plan file path)')
    .option('--client <slug>', 'Specify client by slug')
    .option('--no-branch', 'Skip feature branch creation')
    .option('--dry-run', 'Validate plan and Git state without making changes')
    .option('--force', 'Skip plan freshness warnings')
    .action(async (planArg: string, opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.opts()?.client;

      try {
        const { config, workspacePath } = await resolveClientWorkspace(clientSlug);

        // ─── Resolve plan: task ID prefix OR file path ───────────────────────

        let resolvedPlanPath: string;
        let taskId: string | undefined;

        // Looks like a task ID (hex, ≤16 chars, no path separators)
        const looksLikeTaskId = /^[0-9a-f]{6,16}$/i.test(planArg) && !planArg.includes(path.sep);

        if (looksLikeTaskId) {
          const taskRecord = await findTaskByPrefix(workspacePath, planArg);
          if (!taskRecord) {
            throw new WorkspaceError(
              `No task found with ID prefix "${planArg}". ` +
              'Run: aethra task list',
            );
          }
          taskId = taskRecord.id;
          resolvedPlanPath = taskRecord.planPath;
        } else {
          resolvedPlanPath = path.isAbsolute(planArg)
            ? planArg
            : path.resolve(process.cwd(), planArg);
        }

        if (!(await pathExists(resolvedPlanPath))) {
          throw new WorkspaceError(`Plan file not found: ${resolvedPlanPath}`);
        }

        // Load plan — support both JSON and Markdown (look for companion JSON)
        let plan: ImplementationPlan;
        if (resolvedPlanPath.endsWith('.json')) {
          plan = await readJson<ImplementationPlan>(resolvedPlanPath);
        } else {
          // Try companion JSON
          const jsonPath = resolvedPlanPath.replace(/\.md$/, '.json');
          if (await pathExists(jsonPath)) {
            plan = await readJson<ImplementationPlan>(jsonPath);
          } else {
            throw new WorkspaceError(
              `Plan JSON not found at ${jsonPath}. The plan must have a companion .json file.`,
            );
          }
        }

        console.log(chalk.bold.blue(`\n  Apply Fix — ${config.name}\n`));
        console.log(chalk.gray(`  Plan: ${plan.title}`));
        console.log(chalk.gray(`  Status: ${plan.status}`));
        console.log(chalk.gray(`  Plan ID: ${plan.id}`));
        if (taskId) console.log(chalk.gray(`  Task ID: ${taskId.slice(0, 8)}`));
        console.log();

        // ─── Validation ─────────────────────────────────────────────────────

        if (plan.status === 'draft') {
          logger.error('Plan is still in DRAFT status. It must be reviewed, completed, and approved before applying.');
          console.log(chalk.red('\n  ✗ Plan must be approved before applying.'));
          if (taskId) {
            console.log(chalk.yellow(`  Approve: aethra task approve ${taskId.slice(0, 8)}\n`));
          } else {
            console.log(chalk.yellow('  Update the plan status to "approved" after review.\n'));
          }
          process.exit(1);
        }

        if (plan.status !== 'approved') {
          logger.error(`Plan status is "${plan.status}". Only "approved" plans can be applied.`);
          process.exit(1);
        }

        // Validate acceptance criteria exist
        if (plan.acceptanceCriteria.length === 0) {
          logger.warn('Plan has no acceptance criteria defined. Consider adding them before applying.');
        }

        // ─── Git state check ─────────────────────────────────────────────────

        const repoPath = config.repositoryPath;
        if (!repoPath) {
          logger.warn('No repositoryPath configured in client.yaml. Skipping Git checks.');
          console.log(chalk.yellow('\n  ⚠ No repository configured. Configure repositoryPath in client.yaml.\n'));
          // Still mark task as in-progress so state machine progresses
          if (taskId) {
            await transitionTask(workspacePath, taskId, 'in-progress');
          }
        } else {
          if (!(await pathExists(repoPath))) {
            throw new WorkspaceError(`Repository path not found: ${repoPath}`);
          }

          const gitStatus = await getGitStatus(repoPath);

          if (!gitStatus.isRepo) {
            throw new WorkspaceError(`${repoPath} is not a git repository`);
          }

          console.log(chalk.gray(`  Repository: ${repoPath}`));
          console.log(chalk.gray(`  Branch: ${gitStatus.branch}`));

          if (gitStatus.hasUncommittedChanges) {
            console.log(chalk.yellow('\n  ⚠ Repository has uncommitted changes:'));
            if (gitStatus.modifiedFiles.length > 0) {
              console.log(chalk.yellow(`    Modified: ${gitStatus.modifiedFiles.slice(0, 5).join(', ')}`));
            }
            if (gitStatus.stagedFiles.length > 0) {
              console.log(chalk.yellow(`    Staged: ${gitStatus.stagedFiles.slice(0, 5).join(', ')}`));
            }
            console.log(chalk.yellow('\n  These changes will be preserved. The apply will work on a new branch.'));
          }

          // Check plan freshness against git state
          if (!opts.force) {
            if (plan.planSnapshot?.gitCommit) {
              const currentHead = await queryOutput('git', ['rev-parse', 'HEAD'], { cwd: repoPath });
              if (currentHead && currentHead !== plan.planSnapshot.gitCommit) {
                const commitCount = await queryOutput('git', [
                  'rev-list', '--count',
                  `${plan.planSnapshot.gitCommit}..HEAD`,
                ], { cwd: repoPath });
                logger.warn(
                  `Repository has ${commitCount ?? 'unknown'} new commit(s) since plan creation ` +
                  `(plan: ${plan.planSnapshot.gitCommit.slice(0, 8)}, current: ${currentHead.slice(0, 8)}). ` +
                  'Review whether plan assumptions are still valid. Use --force to skip.',
                );
              }
            }

            // Fallback: time-based check
            if (plan.createdAt) {
              const planAge = Date.now() - new Date(plan.createdAt).getTime();
              if (planAge > 7 * 24 * 60 * 60 * 1000) {
                logger.warn(
                  `Plan was created ${Math.round(planAge / (24 * 60 * 60 * 1000))} days ago. ` +
                  'Verify that assumptions are still valid. Use --force to skip.',
                );
              }
            }
          }

          if (opts.dryRun) {
            console.log(chalk.cyan('\n  Dry run — no changes made.\n'));
            console.log(chalk.bold('  Validation passed:'));
            console.log(chalk.green(`  ✓ Plan "${plan.title}" is approved`));
            console.log(chalk.green(`  ✓ Repository found at ${repoPath}`));
            console.log(chalk.green(`  ✓ Git repo valid (branch: ${gitStatus.branch})`));
            return;
          }

          // Create feature branch (if not skipped)
          let branchName: string | undefined;
          if (opts.branch !== false && !gitStatus.hasUncommittedChanges) {
            branchName = `aethra/${plan.id.slice(0, 8)}-${
              plan.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)
            }`;
            await createFeatureBranch(branchName, repoPath);
            plan.gitBranch = branchName;

            // Save branch name without transitioning to in-progress
            // The task stays at 'approved' until implementation actually starts
            if (taskId) {
              await updateTask(workspacePath, taskId, { gitBranch: branchName });
            }
          }
        }

        // ─── Agent adapter ───────────────────────────────────────────────────

        const adapter = getDefaultAdapter();
        const repoPathResolved = config.repositoryPath ?? process.cwd();

        // Select relevant skills for the task
        const skillSelection = await selectSkillsForTask(
          plan.taskDescription,
          config.platform,
          'implement',
          path.join(workspacePath, 'skills'),
        );

        const agentResult = await adapter.launch({
          plan,
          planPath: resolvedPlanPath,
          workspacePath,
          repositoryPath: repoPathResolved,
          gitBranch: plan.gitBranch,
          skills: skillSelection.selectedSkills,
          evidencePaths: plan.evidenceBasis.map((e) => e.path),
          taskId,
        }, { dryRun: opts.dryRun });

        console.log(chalk.bold.yellow('\n  Implementation preparation\n'));
        console.log(chalk.gray(`  Agent instructions: ${agentResult.instructionPath}`));

        if (agentResult.status === 'not-available') {
          console.log('\n  The actual code changes must be made by an AI agent or engineer.');
          console.log('\n  To implement with Claude Code, run from the repository directory:');
          console.log(chalk.cyan(`\n    cd ${repoPathResolved}`));
          console.log(chalk.cyan(`    claude  # then reference: ${agentResult.instructionPath}\n`));
        }

        if (taskId) {
          console.log('  To mark implementation as started:');
          console.log(chalk.cyan(`    aethra task start ${taskId.slice(0, 8)}\n`));
        }

        console.log('  After implementation, run:');
        const verifyCmd = taskId
          ? `aethra verify --task ${taskId.slice(0, 8)}`
          : 'aethra verify';
        console.log(chalk.cyan(`    ${verifyCmd}\n`));

        console.log(chalk.bold('  Plan acceptance criteria to satisfy:\n'));
        for (const ac of plan.acceptanceCriteria) {
          console.log(chalk.gray(`  □ ${ac.description}`));
          console.log(chalk.gray(`      Verify via: ${ac.verificationMethod}`));
        }
        console.log();
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`apply-fix failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });
}
