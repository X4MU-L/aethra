/**
 * `aethra report` — generate engineering and client-facing reports.
 */

import type { Command } from 'commander';
import path from 'path';
import chalk from 'chalk';
import { resolveClientWorkspace } from '../../config/manager.js';
import { loadLatestAudit } from '../../audit/runner.js';
import { writeFile, ensureDir } from '../../engine/fs.js';
import { logger } from '../../core/logger.js';
import { toAethraError } from '../../core/errors.js';
import { generateMarkdownReport, generateJsonReport } from '../../reporting/generator.js';

export function registerReportCommand(program: Command): void {
  program
    .command('report')
    .description('Generate an internal engineering report or client-facing summary')
    .option('--client <slug>', 'Specify client by slug')
    .option('--type <type>', 'Report type: internal or client-facing', 'internal')
    .option('--output <path>', 'Output file path (default: reports/)')
    .option('--format <fmt>', 'Output format: markdown or json', 'markdown')
    .action(async (opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.opts()?.client;

      try {
        const { config, workspacePath } = await resolveClientWorkspace(clientSlug);

        console.log(chalk.bold.blue(`\n  Report — ${config.name}\n`));
        console.log(chalk.gray(`  Type: ${opts.type}`));

        // Load audit data
        const evidenceDir = path.join(workspacePath, 'evidence');
        const audit = await loadLatestAudit(evidenceDir, 'baseline');

        const reportsDir = path.join(workspacePath, 'reports');
        await ensureDir(reportsDir);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `${opts.type}-report-${timestamp}.${opts.format === 'json' ? 'json' : 'md'}`;
        const outputPath = opts.output ?? path.join(reportsDir, filename);

        const reportType = opts.type as 'internal' | 'client-facing';
        const reportInput = { clientName: config.name, clientSlug: config.slug, audit, workspacePath, type: reportType };

        if (opts.format === 'json') {
          const report = generateJsonReport(reportInput);
          await writeFile(outputPath, JSON.stringify(report, null, 2));
        } else {
          const report = generateMarkdownReport(reportInput);
          await writeFile(outputPath, report);
        }

        logger.success(`Report written: ${outputPath}`);
        console.log(chalk.green(`\n  ✓ Report generated: ${outputPath}\n`));
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`report failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });
}
