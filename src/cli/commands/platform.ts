/**
 * `aethra platform detect` — detect the platform of a repository or URL.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { detectPlatformFromDirectory } from '../../platforms/detector.js';
import { resolveClientWorkspace } from '../../config/manager.js';
import { expandPath, pathExists } from '../../engine/fs.js';
import { logger } from '../../core/logger.js';
import { toAethraError } from '../../core/errors.js';

export function registerPlatformCommand(program: Command): void {
  const platform = program
    .command('platform')
    .description('Platform detection and configuration');

  platform
    .command('detect [directory]')
    .description('Detect the platform of a repository directory')
    .option('--client <slug>', 'Specify client by slug')
    .option('--json', 'Output as JSON')
    .action(async (directory: string | undefined, opts, cmd) => {
      const jsonMode = opts.json || cmd.parent?.parent?.opts()?.json;

      try {
        let targetDir = directory;

        if (!targetDir) {
          const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;
          try {
            const { config } = await resolveClientWorkspace(clientSlug);
            targetDir = config.repositoryPath ?? process.cwd();
          } catch {
            targetDir = process.cwd();
          }
        }

        const resolved = expandPath(targetDir);
        if (!(await pathExists(resolved))) {
          logger.error(`Directory not found: ${resolved}`);
          process.exit(1);
        }

        const detection = await detectPlatformFromDirectory(resolved);

        if (jsonMode) {
          console.log(JSON.stringify(detection, null, 2));
          return;
        }

        console.log(chalk.bold.blue('\n  Platform detection\n'));
        console.log(chalk.gray(`  Directory: ${resolved}`));
        console.log();

        const confColor =
          detection.confidence > 0.8
            ? chalk.green
            : detection.confidence > 0.5
            ? chalk.yellow
            : chalk.red;

        console.log(`  Platform: ${chalk.bold(detection.platform)}`);
        console.log(`  Confidence: ${confColor(`${Math.round(detection.confidence * 100)}%`)}`);

        if (detection.evidence.length > 0) {
          console.log(chalk.bold('\n  Evidence:\n'));
          for (const ev of detection.evidence) console.log(chalk.gray(`  • ${ev}`));
        }

        if (detection.confidence < 0.5) {
          console.log(chalk.yellow('\n  ⚠ Low confidence. Consider providing more information via client.yaml.'));
        }
        console.log();
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`platform detect failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });
}
