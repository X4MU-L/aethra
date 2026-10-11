/**
 * `aethra task` — task lifecycle management.
 * Tasks are the durable unit of work: plan → approve → implement → verify → done.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { resolveClientWorkspace } from '../../config/manager.js';
import { listTasks, findTaskByPrefix, transitionTask } from '../../engine/tasks.js';
import { pathExists, readJson } from '../../engine/fs.js';
import { logger } from '../../core/logger.js';
import { toAethraError } from '../../core/errors.js';
import type { ImplementationPlan } from '../../core/schemas.js';

const STATUS_ICON: Record<string, string> = {
  planned: chalk.gray('◌'),
  approved: chalk.cyan('●'),
  'in-progress': chalk.yellow('▶'),
  verifying: chalk.magenta('⟳'),
  completed: chalk.green('✓'),
  blocked: chalk.red('!'),
  abandoned: chalk.gray('✗'),
};

const STATUS_LABEL: Record<string, string> = {
  planned: chalk.gray('planned'),
  approved: chalk.cyan('approved'),
  'in-progress': chalk.yellow('in-progress'),
  verifying: chalk.magenta('verifying'),
  completed: chalk.green('completed'),
  blocked: chalk.red('blocked'),
  abandoned: chalk.gray('abandoned'),
};

export function registerTaskCommand(program: Command): void {
  const task = program
    .command('task')
    .description('Task lifecycle management');

  // ── task list ──────────────────────────────────────────────────────────────
  task
    .command('list')
    .alias('ls')
    .description('List all tasks for the active client workspace')
    .option('--client <slug>', 'Specify client by slug')
    .option('--status <status>', 'Filter by status (planned, approved, in-progress, completed, etc.)')
    .option('--json', 'Output as JSON')
    .action(async (opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;
      const jsonMode = opts.json || cmd.parent?.parent?.opts()?.json;

      try {
        const { config, workspacePath } = await resolveClientWorkspace(clientSlug);
        let tasks = await listTasks(workspacePath);

        if (opts.status) {
          tasks = tasks.filter((t) => t.status === opts.status);
        }

        if (jsonMode) {
          console.log(JSON.stringify(tasks, null, 2));
          return;
        }

        console.log(chalk.bold.blue(`\n  Tasks — ${config.name}\n`));

        if (tasks.length === 0) {
          const hint = opts.status
            ? `No tasks with status "${opts.status}".`
            : 'No tasks yet. Run: aethra plan-fix "<task description>"';
          console.log(chalk.gray(`  ${hint}\n`));
          return;
        }

        for (const t of tasks) {
          const icon = STATUS_ICON[t.status] ?? chalk.gray('?');
          console.log(`  ${icon}  ${chalk.bold(t.id.slice(0, 8))}  ${t.title}`);
          console.log(chalk.gray(`        Status: ${STATUS_LABEL[t.status]}`));
          console.log(chalk.gray(`        Created: ${t.createdAt.split('T')[0]}`));
          if (t.approvedBy) console.log(chalk.gray(`        Approved by: ${t.approvedBy}`));
          if (t.gitBranch) console.log(chalk.gray(`        Branch: ${t.gitBranch}`));
          console.log();
        }

        const statusCounts = tasks.reduce<Record<string, number>>((acc, t) => {
          acc[t.status] = (acc[t.status] ?? 0) + 1;
          return acc;
        }, {});
        const summary = Object.entries(statusCounts).map(([s, n]) => `${n} ${s}`).join(', ');
        console.log(chalk.gray(`  Total: ${tasks.length} task(s) — ${summary}\n`));
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`task list failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });

  // ── task show ──────────────────────────────────────────────────────────────
  task
    .command('show <id>')
    .alias('inspect')
    .description('Show details of a specific task')
    .option('--client <slug>', 'Specify client by slug')
    .option('--json', 'Output as JSON')
    .action(async (id: string, opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;
      const jsonMode = opts.json || cmd.parent?.parent?.opts()?.json;

      try {
        const { workspacePath } = await resolveClientWorkspace(clientSlug);
        const t = await findTaskByPrefix(workspacePath, id);

        if (!t) {
          logger.error(`Task not found: ${id}`);
          process.exit(1);
        }

        if (jsonMode) {
          console.log(JSON.stringify(t, null, 2));
          return;
        }

        const icon = STATUS_ICON[t.status] ?? '?';
        console.log(chalk.bold.blue(`\n  Task ${t.id.slice(0, 8)}\n`));
        console.log(`  ${icon}  ${chalk.bold(t.title)}`);
        console.log();
        console.log(`  Status:    ${STATUS_LABEL[t.status]}`);
        console.log(`  ID:        ${t.id}`);
        console.log(`  Client:    ${t.clientSlug}`);
        console.log(`  Created:   ${t.createdAt}`);
        console.log(`  Updated:   ${t.updatedAt}`);
        if (t.approvedBy) console.log(`  Approved:  ${t.approvedBy} at ${t.approvedAt}`);
        if (t.startedAt) console.log(`  Started:   ${t.startedAt}`);
        if (t.completedAt) console.log(`  Completed: ${t.completedAt}`);
        if (t.gitBranch) console.log(`  Branch:    ${t.gitBranch}`);
        if (t.notes) console.log(`  Notes:     ${t.notes}`);

        // Load plan for acceptance criteria
        if (await pathExists(t.planPath)) {
          const plan = await readJson<ImplementationPlan>(t.planPath);

          if (plan.acceptanceCriteria.length > 0) {
            console.log(chalk.bold('\n  Acceptance criteria:\n'));
            for (const ac of plan.acceptanceCriteria) {
              const passed = ac.passed === true
                ? chalk.green('✓')
                : ac.passed === false
                  ? chalk.red('✗')
                  : chalk.gray('□');
              console.log(`  ${passed} ${ac.description}`);
              console.log(chalk.gray(`      ${ac.verificationMethod}`));
            }
          }

          if (plan.risks.length > 0) {
            console.log(chalk.bold('\n  Risks:\n'));
            for (const r of plan.risks) {
              console.log(chalk.yellow(`  ⚠ ${r}`));
            }
          }

          console.log(chalk.bold('\n  Plan files:\n'));
          console.log(chalk.gray(`  JSON: ${t.planPath}`));
          const mdPath = t.planPath.replace(/\.json$/, '.md');
          if (await pathExists(mdPath)) {
            console.log(chalk.gray(`  Markdown: ${mdPath}`));
          }
        } else {
          console.log(chalk.yellow(`\n  ⚠ Plan file not found: ${t.planPath}`));
        }

        console.log();

        // Suggest next action
        const nextAction: Record<string, string> = {
          planned: `  Next: review the plan, then run: ${chalk.cyan(`aethra task approve ${t.id.slice(0, 8)}`)}`,
          approved: `  Next: implement the plan, then run: ${chalk.cyan(`aethra verify --task ${t.id.slice(0, 8)}`)}`,
          'in-progress': `  Next: continue implementation, then run: ${chalk.cyan(`aethra verify --task ${t.id.slice(0, 8)}`)}`,
          verifying: `  Verification in progress. Check verification results.`,
          completed: `  Task complete. Run: ${chalk.cyan('aethra report')} to generate the report.`,
          blocked: `  Task blocked. Investigate and re-run: ${chalk.cyan(`aethra apply-fix ${t.id.slice(0, 8)}`)}`,
        };
        if (nextAction[t.status]) {
          console.log(chalk.gray(nextAction[t.status]));
          console.log();
        }
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`task show failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });

  // ── task approve ───────────────────────────────────────────────────────────
  task
    .command('approve <id>')
    .description('Approve a planned task for implementation')
    .option('--client <slug>', 'Specify client by slug')
    .option('--by <name>', 'Name of the approver (defaults to system user)', process.env['USER'] ?? 'engineer')
    .option('--notes <text>', 'Optional approval notes')
    .action(async (id: string, opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;

      try {
        const { config, workspacePath } = await resolveClientWorkspace(clientSlug);
        const t = await findTaskByPrefix(workspacePath, id);

        if (!t) {
          logger.error(`Task not found: ${id}`);
          process.exit(1);
        }

        if (t.status === 'approved') {
          console.log(chalk.yellow(`\n  Task ${t.id.slice(0, 8)} is already approved.\n`));
          return;
        }

        if (t.status !== 'planned') {
          logger.error(`Cannot approve task in status "${t.status}". Only "planned" tasks can be approved.`);
          process.exit(1);
        }

        // Also update the plan JSON status to 'approved' for backward compat
        if (await pathExists(t.planPath)) {
          const plan = await readJson<ImplementationPlan>(t.planPath);
          plan.status = 'approved';
          plan.approvedBy = opts.by;
          plan.approvedAt = new Date().toISOString();
          const { writeJson } = await import('../../engine/fs.js');
          await writeJson(t.planPath, plan);
        }

        const approvedTask = await transitionTask(workspacePath, t.id, 'approved', {
          approvedBy: opts.by,
          approvedAt: new Date().toISOString(),
          notes: opts.notes,
        });

        console.log(chalk.bold.green(`\n  ✓ Task approved\n`));
        console.log(`  Task:      ${approvedTask.title}`);
        console.log(`  ID:        ${approvedTask.id.slice(0, 8)}`);
        console.log(`  Client:    ${config.name}`);
        console.log(`  Approved by: ${approvedTask.approvedBy}`);
        console.log(chalk.gray('\n  Next: implement the plan with an AI agent or engineer.'));
        console.log(chalk.gray(`  Then verify: aethra verify --task ${approvedTask.id.slice(0, 8)}\n`));
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`task approve failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });

  // ── task block ─────────────────────────────────────────────────────────────
  task
    .command('block <id>')
    .description('Mark a task as blocked')
    .option('--client <slug>', 'Specify client by slug')
    .option('--notes <text>', 'Reason for block (required)')
    .action(async (id: string, opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;

      try {
        const { workspacePath } = await resolveClientWorkspace(clientSlug);
        const t = await findTaskByPrefix(workspacePath, id);

        if (!t) {
          logger.error(`Task not found: ${id}`);
          process.exit(1);
        }

        if (!opts.notes) {
          logger.error('--notes <reason> is required when blocking a task');
          process.exit(1);
        }

        const updated = await transitionTask(workspacePath, t.id, 'blocked', {
          notes: opts.notes,
        });

        console.log(chalk.bold.red(`\n  Task blocked\n`));
        console.log(`  Task: ${updated.title}`);
        console.log(`  ID:   ${updated.id.slice(0, 8)}`);
        console.log(`  Reason: ${opts.notes}\n`);
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`task block failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });

  // ── task abandon ───────────────────────────────────────────────────────────
  task
    .command('abandon <id>')
    .description('Mark a task as abandoned')
    .option('--client <slug>', 'Specify client by slug')
    .option('--notes <text>', 'Reason for abandoning')
    .action(async (id: string, opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;

      try {
        const { workspacePath } = await resolveClientWorkspace(clientSlug);
        const t = await findTaskByPrefix(workspacePath, id);

        if (!t) {
          logger.error(`Task not found: ${id}`);
          process.exit(1);
        }

        if (t.status === 'completed') {
          logger.error('Cannot abandon a completed task.');
          process.exit(1);
        }

        const updated = await transitionTask(workspacePath, t.id, 'abandoned', {
          notes: opts.notes,
        });

        console.log(chalk.bold.gray(`\n  Task abandoned: ${updated.title}\n`));
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`task abandon failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });
}
