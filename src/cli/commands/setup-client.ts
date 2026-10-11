/**
 * `aethra setup-client <facts-directory>` — run the full client onboarding pipeline.
 */

import type { Command } from 'commander';
import path from 'path';
import { runOnboarding } from '../../core/onboarding.js';
import { expandPath } from '../../engine/fs.js';
import { logger } from '../../core/logger.js';
import { toAethraError } from '../../core/errors.js';

export function registerSetupClientCommand(program: Command): void {
  program
    .command('setup-client <facts-directory>')
    .description('Onboard a new client from a facts directory')
    .option('--slug <slug>', 'Client slug (derived from name if not specified)')
    .option('--workspace <path>', 'Custom workspace path (default: ~/Aethra/clients/<slug>)')
    .option('--skip-audit', 'Skip the baseline website audit')
    .option('--skip-research', 'Skip HTTP reachability checks')
    .option('--resume', 'Resume a previously started onboarding')
    .option('--dry-run', 'Show what would be created without writing files')
    .action(async (factsDirectory: string, opts) => {
      const resolvedFactsDir = expandPath(
        path.isAbsolute(factsDirectory) ? factsDirectory : path.resolve(process.cwd(), factsDirectory),
      );

      try {
        const result = await runOnboarding({
          factsDir: resolvedFactsDir,
          clientSlug: opts.slug,
          workspacePath: opts.workspace ? expandPath(opts.workspace) : undefined,
          skipAudit: opts.skipAudit ?? false,
          skipResearch: opts.skipResearch ?? false,
          resume: opts.resume ?? false,
          dryRun: opts.dryRun ?? false,
        });

        if (!result.success) {
          logger.error('Onboarding did not complete successfully.');
          process.exit(1);
        }
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`setup-client failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });
}
