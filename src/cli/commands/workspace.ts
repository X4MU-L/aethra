/**
 * `aethra workspace` — workspace management commands.
 */

import type { Command } from 'commander';
import path from 'path';
import chalk from 'chalk';
import fs from 'fs-extra';
import { resolveClientWorkspace, getWorkspaceRoot, updateClientConfig } from '../../config/manager.js';
import { loadWorkspaceStateFile } from '../../engine/workspace.js';
import { loadLatestAudit } from '../../audit/runner.js';
import { pathExists, listDir } from '../../engine/fs.js';
import { logger } from '../../core/logger.js';
import { toAethraError } from '../../core/errors.js';
import type { ClientConfig } from '../../core/schemas.js';

export function registerWorkspaceCommand(program: Command): void {
  const workspace = program
    .command('workspace')
    .description('Workspace management');

  workspace
    .command('status')
    .description('Show the status of the active client workspace')
    .option('--client <slug>', 'Specify client by slug')
    .option('--json', 'Output as JSON')
    .action(async (opts, cmd) => {
      const jsonMode = opts.json || cmd.parent?.parent?.opts()?.json;
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;

      try {
        const { config, workspacePath } = await resolveClientWorkspace(clientSlug);
        const evidenceDir = path.join(workspacePath, 'evidence');

        const state = await loadWorkspaceStateFile(workspacePath);
        const latestAudit = await loadLatestAudit(evidenceDir, 'baseline');

        // Count plans
        const plansDir = path.join(workspacePath, 'plans');
        const planCount = (await pathExists(plansDir))
          ? (await listDir(plansDir)).filter((f) => f.endsWith('.json')).length
          : 0;

        // Count evidence artifacts
        const screenshotDir = path.join(evidenceDir, 'screenshots');
        const screenshotCount = (await pathExists(screenshotDir))
          ? (await listDir(screenshotDir)).length
          : 0;

        const status = {
          client: config.name,
          slug: config.slug,
          workspace: config.workspace ?? workspacePath,
          platform: config.platform ?? 'unknown',
          primaryUrl: config.primaryUrl ?? 'not configured',
          lastAudit: latestAudit
            ? {
                id: latestAudit.id,
                type: latestAudit.type,
                status: latestAudit.status,
                completedAt: latestAudit.completedAt,
                findings: latestAudit.findings.length,
                pagesInspected: latestAudit.pagesInspected.length,
              }
            : null,
          onboardingStages: state?.completedStages ?? [],
          artifacts: {
            screenshots: screenshotCount,
            plans: planCount,
          },
        };

        if (jsonMode) {
          console.log(JSON.stringify(status, null, 2));
          return;
        }

        console.log(chalk.bold.blue(`\n  Workspace — ${config.name}\n`));
        console.log(`  Slug:      ${config.slug}`);
        console.log(`  Platform:  ${config.platform ?? chalk.gray('unknown')}`);
        console.log(`  URL:       ${config.primaryUrl ?? chalk.gray('not configured')}`);
        // Use config.workspace for correct canonical path (avoids macOS case-insensitive CWD variations)
        console.log(`  Path:      ${config.workspace ?? workspacePath}`);

        console.log(chalk.bold('\n  Onboarding progress:\n'));
        const allStages = ['facts-read', 'research-discovery', 'baseline-audit', 'workspace-created', 'platform-determined', 'agent-tooling', 'validated'];
        for (const stage of allStages) {
          const done = state?.completedStages.includes(stage as typeof state.completedStages[number]) ?? false;
          console.log(`  ${done ? chalk.green('✓') : chalk.gray('○')} ${stage}`);
        }

        if (latestAudit) {
          console.log(chalk.bold('\n  Last audit:\n'));
          console.log(`  ID: ${latestAudit.id}`);
          console.log(`  Status: ${latestAudit.status}`);
          console.log(`  Completed: ${latestAudit.completedAt ?? 'not completed'}`);
          console.log(`  Findings: ${latestAudit.findings.length}`);
          console.log(`  Pages inspected: ${latestAudit.pagesInspected.length}`);
        } else {
          console.log(chalk.bold('\n  Last audit:\n'));
          console.log(chalk.gray('  No audit yet. Run: aethra audit'));
        }

        console.log(chalk.bold('\n  Artifacts:\n'));
        console.log(`  Screenshots: ${screenshotCount}`);
        console.log(`  Plans: ${planCount}`);
        console.log();
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`workspace status failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });

  workspace
    .command('list')
    .description('List all known client workspaces')
    .option('--json', 'Output as JSON')
    .action(async (opts, cmd) => {
      const jsonMode = opts.json || cmd.parent?.parent?.opts()?.json;

      try {
        const workspaceRoot = await getWorkspaceRoot();

        if (!(await pathExists(workspaceRoot))) {
          if (jsonMode) {
            console.log(JSON.stringify({ workspaces: [], workspaceRoot }));
          } else {
            console.log(chalk.gray(`\n  No workspace root found at ${workspaceRoot}\n`));
            console.log(chalk.gray('  Run: aethra init\n'));
          }
          return;
        }

        const entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
        const workspaces: Array<{
          slug: string;
          name: string;
          platform: string;
          primaryUrl: string | undefined;
          path: string;
          lastModified: string;
        }> = [];

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const wsPath = path.join(workspaceRoot, entry.name);
          const configPath = path.join(wsPath, 'client.yaml');

          if (!(await pathExists(configPath))) continue;

          try {
            const { loadClientConfig } = await import('../../config/manager.js');
            const config: ClientConfig = await loadClientConfig(wsPath);
            const stat = await fs.stat(wsPath);

            workspaces.push({
              slug: config.slug,
              name: config.name,
              platform: config.platform ?? 'unknown',
              primaryUrl: config.primaryUrl,
              path: wsPath,
              lastModified: stat.mtime.toISOString(),
            });
          } catch {
            // Skip workspaces with invalid configs
          }
        }

        workspaces.sort((a, b) => b.lastModified.localeCompare(a.lastModified));

        if (jsonMode) {
          console.log(JSON.stringify({ workspaces, workspaceRoot }, null, 2));
          return;
        }

        console.log(chalk.bold.blue(`\n  Client Workspaces — ${workspaceRoot}\n`));

        if (workspaces.length === 0) {
          console.log(chalk.gray('  No client workspaces found.\n'));
          console.log(chalk.gray('  Run: aethra setup-client <facts-directory>\n'));
          return;
        }

        for (const ws of workspaces) {
          console.log(`  ${chalk.bold(ws.slug)}`);
          console.log(chalk.gray(`    Name:     ${ws.name}`));
          console.log(chalk.gray(`    Platform: ${ws.platform}`));
          if (ws.primaryUrl) console.log(chalk.gray(`    URL:      ${ws.primaryUrl}`));
          console.log(chalk.gray(`    Path:     ${ws.path}`));
          console.log();
        }

        console.log(chalk.gray(`  Total: ${workspaces.length} workspace(s)\n`));
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`workspace list failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });

  workspace
    .command('set-local <url>')
    .description('Set the local development URL for the active client workspace')
    .option('--client <slug>', 'Specify client by slug')
    .option('--tool <tool>', 'Local dev tool in use (ddev, localwp, docker, none)')
    .action(async (url: string, opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;

      try {
        // Validate URL
        try {
          new URL(url);
        } catch {
          logger.error(`Invalid URL: "${url}". Must be a valid URL like http://localhost:3000`);
          process.exit(1);
        }

        const { workspacePath } = await resolveClientWorkspace(clientSlug);

        const updates: Parameters<typeof updateClientConfig>[1] = { localUrl: url };
        if (opts.tool) {
          const validTools = ['ddev', 'localwp', 'docker', 'none', 'unknown'];
          if (!validTools.includes(opts.tool)) {
            logger.error(`Invalid tool: "${opts.tool}". Must be one of: ${validTools.join(', ')}`);
            process.exit(1);
          }
          updates.localDevTool = opts.tool as 'ddev' | 'localwp' | 'docker' | 'none' | 'unknown';
        }

        const updated = await updateClientConfig(workspacePath, updates);

        console.log(chalk.bold.green(`\n  Local URL configured\n`));
        console.log(`  Client:    ${updated.name}`);
        console.log(`  Local URL: ${chalk.cyan(url)}`);
        if (updated.localDevTool) console.log(`  Dev tool:  ${updated.localDevTool}`);
        console.log(chalk.gray('\n  Run local audit: aethra audit --local\n'));
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`workspace set-local failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });
}
