/**
 * `aethra init` — initialise the central Aethra configuration and workspace directories.
 */

import type { Command } from 'commander';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { initGlobalConfig, AETHRA_HOME } from '../../config/manager.js';
import { ensureDir, pathExists } from '../../engine/fs.js';
import { checkAllTools } from '../../engine/tools.js';
import { installBuiltinSkills } from '../../skills/manager.js';
import { logger } from '../../core/logger.js';
import { toAethraError } from '../../core/errors.js';

const BUILTIN_SKILLS_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../templates/skills',
);

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialise the central Aethra configuration and workspace directories')
    .option('--force', 'Overwrite existing configuration (backs up first)')
    .option('--skip-skills', 'Skip installing built-in skills')
    .action(async (opts) => {
      console.log(chalk.bold.blue('\n  Aethra Workbench — Initialisation\n'));

      try {
        // 1. Create ~/.aethra/ structure
        const dirs = [
          AETHRA_HOME,
          path.join(AETHRA_HOME, 'skills'),
          path.join(AETHRA_HOME, 'scripts'),
          path.join(AETHRA_HOME, 'templates'),
        ];
        await ensureDir(dirs[0]!);
        for (const dir of dirs.slice(1)) await ensureDir(dir);
        logger.success(`Aethra home: ${AETHRA_HOME}`);

        // 2. Initialise global config
        const created = await initGlobalConfig(opts.force ?? false);
        if (created) {
          logger.success('Global configuration created');
        } else {
          logger.info('Global configuration already exists (use --force to recreate)');
        }

        // 3. Create default workspace root
        const workspaceRoot = path.join(os.homedir(), 'Aethra', 'clients');
        await ensureDir(workspaceRoot);
        logger.success(`Client workspace root: ${workspaceRoot}`);

        // 4. Install built-in skills
        if (!opts.skipSkills) {
          if (await pathExists(BUILTIN_SKILLS_DIR)) {
            const { installed, skipped } = await installBuiltinSkills(
              BUILTIN_SKILLS_DIR,
              opts.force ?? false,
            );
            if (installed > 0) {
              logger.success(`Built-in skills installed (${installed} new, ${skipped} already present)`);
            } else {
              logger.info(`Built-in skills already installed (${skipped} skills). Use --force to update.`);
            }
          } else {
            logger.info('Built-in skills directory not found — skipping skill installation');
          }
        }

        // 5. Environment check summary
        console.log(chalk.bold('\n  Environment summary:\n'));
        const tools = await checkAllTools();
        for (const tool of tools) {
          const icon = tool.status === 'ok' ? chalk.green('✓') : tool.status === 'warning' ? chalk.yellow('⚠') : chalk.red('✗');
          const req = tool.required ? '' : chalk.gray(' (optional)');
          console.log(`  ${icon} ${tool.name}${req}${tool.version ? chalk.gray(` v${tool.version}`) : ''}${tool.message ? chalk.gray(` — ${tool.message}`) : ''}`);
          if (tool.status !== 'ok' && tool.installHint) {
            console.log(chalk.gray(`      → ${tool.installHint}`));
          }
        }

        console.log(chalk.bold.green('\n  Aethra initialised successfully.\n'));
        console.log(chalk.cyan('  Next: aethra setup-client ~/path/to/client-facts\n'));
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`Initialisation failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });
}
