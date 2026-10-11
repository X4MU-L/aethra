/**
 * `aethra audit` — run the website audit for the active client.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { resolveClientWorkspace, updateClientConfig } from '../../config/manager.js';
import { runAudit, loadLatestAudit } from '../../audit/runner.js';
import { compareAudits } from '../../audit/compare.js';
import { writeJson } from '../../engine/fs.js';
import { updateLocalAuditSection } from '../../engine/workspace.js';
import { logger } from '../../core/logger.js';
import { toAethraError } from '../../core/errors.js';
import type { AuditComparison } from '../../audit/compare.js';

export function registerAuditCommand(program: Command): void {
  program
    .command('audit')
    .description('Run the website audit for the active client workspace')
    .option('--refresh', 'Run a refresh audit (preserves baseline)')
    .option('--local [url]', 'Audit local dev server. Uses client.yaml localUrl if no URL given.')
    .option('--client <slug>', 'Specify client by slug')
    .option('--max-pages <n>', 'Maximum pages to inspect', '10')
    .option('--no-lighthouse', 'Skip Lighthouse performance audit')
    .option('--no-screenshots', 'Skip screenshot capture')
    .option('--json', 'Output results as JSON')
    .action(async (opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.opts()?.client;

      try {
        const { config, workspacePath } = await resolveClientWorkspace(clientSlug);

        const isLocal = opts.local !== undefined && opts.local !== false;
        const localUrlArg = typeof opts.local === 'string' ? opts.local : undefined;

        // Determine audit type
        const type = isLocal ? 'local' : opts.refresh ? 'refresh' : 'baseline';
        const evidenceDir = path.join(workspacePath, 'evidence');

        // If a URL was passed to --local, save it to client.yaml for future runs
        if (localUrlArg) {
          try {
            new URL(localUrlArg); // validate
          } catch {
            logger.error(`Invalid local URL: "${localUrlArg}". Must be a valid URL like http://localhost:3000`);
            process.exit(1);
          }
          await updateClientConfig(workspacePath, { localUrl: localUrlArg });
          logger.info(`Local URL saved to client.yaml: ${localUrlArg}`);
        }

        // Check if baseline exists and warn for production audits
        if (type === 'baseline') {
          const existing = await loadLatestAudit(evidenceDir, 'baseline');
          if (existing) {
            console.log(chalk.yellow(
              `⚠ A baseline audit already exists (${existing.id}). ` +
              'Use --refresh to run a new audit without overwriting the baseline.',
            ));
          }
        }

        if (isLocal) {
          const effectiveLocalUrl = localUrlArg ?? config.localUrl;
          console.log(chalk.bold.blue(`\n  Local Audit — ${config.name}\n`));
          console.log(chalk.gray(`  Target: ${effectiveLocalUrl ?? chalk.red('Not configured — pass a URL: aethra audit --local http://localhost:3000')}`));
          console.log(chalk.gray(`  Production baseline: ${config.primaryUrl ?? 'none'}`));
          console.log(chalk.gray(`  Workspace: ${workspacePath}\n`));
        } else {
          console.log(chalk.bold.blue(`\n  Audit — ${config.name}\n`));
          console.log(chalk.gray(`  Type: ${type}`));
          console.log(chalk.gray(`  URL: ${config.primaryUrl ?? 'Not configured'}`));
          console.log(chalk.gray(`  Workspace: ${workspacePath}\n`));
        }

        const audit = await runAudit(config, workspacePath, {
          type,
          urlOverride: localUrlArg,
          maxPages: parseInt(opts.maxPages ?? '10', 10),
          runLighthouseAudit: opts.lighthouse !== false,
          captureScreenshots: opts.screenshots !== false,
        });

        // For local audits: load baseline, run comparison, print table, save JSON
        let comparison: AuditComparison | null = null;
        if (type === 'local' && audit.status !== 'failed') {
          const baseline = await loadLatestAudit(evidenceDir, 'baseline');
          if (baseline) {
            try {
              comparison = await compareAudits(baseline, audit);
              const comparePath = path.join(evidenceDir, `local-compare-${audit.id}.json`);
              await writeJson(comparePath, comparison);
              logger.debug(`Comparison saved: ${comparePath}`);

              // Update knowledge base with local audit section
              await updateLocalAuditSection(workspacePath, audit, comparison).catch((err) => {
                logger.warn(`Could not update technical-findings.md: ${(err as Error).message}`);
              });
            } catch (err) {
              logger.warn(`Comparison failed: ${(err as Error).message}`);
            }
          } else {
            console.log(chalk.yellow('\n  ⚠ No baseline audit found — skipping comparison. Run `aethra audit` first.\n'));
          }
        }

        if (opts.json || cmd.parent?.opts()?.json) {
          console.log(JSON.stringify({ audit, comparison }, null, 2));
          return;
        }

        // ── Human-readable summary ────────────────────────────────────────────
        console.log(chalk.bold.green(`\n  Audit complete: ${audit.id}\n`));
        console.log(`  Status: ${audit.status}`);
        console.log(`  Pages inspected: ${audit.pagesInspected.length}`);
        console.log(`  Findings: ${audit.findings.length}`);
        console.log(`  Artifacts: ${audit.artifactManifest.length}`);

        if (audit.findings.length > 0) {
          console.log(chalk.bold('\n  Top findings:\n'));
          const top = audit.findings
            .sort((a, b) => {
              const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
              return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
            })
            .slice(0, 5);

          for (const finding of top) {
            const severityColor =
              finding.severity === 'critical' || finding.severity === 'high'
                ? chalk.red
                : finding.severity === 'medium'
                ? chalk.yellow
                : chalk.gray;
            console.log(`  ${severityColor(`[${finding.severity.toUpperCase()}]`)} ${finding.title}`);
            if (finding.description) console.log(chalk.gray(`    ${finding.description.slice(0, 100)}`));
          }
        }

        // ── Comparison table for local audits ────────────────────────────────
        if (comparison) {
          printComparisonTable(comparison);
        }

        if (audit.limitations.length > 0) {
          console.log(chalk.bold('\n  Limitations:\n'));
          for (const lim of audit.limitations) console.log(chalk.yellow(`  ⚠ ${lim}`));
        }

        if (audit.errors.length > 0) {
          console.log(chalk.bold('\n  Errors:\n'));
          for (const err of audit.errors) console.log(chalk.red(`  ✗ ${err}`));
        }

        const evidenceNote = type === 'local'
          ? path.join(workspacePath, 'evidence', 'screenshots', 'local')
          : path.join(workspacePath, 'evidence');

        console.log(chalk.cyan(`\n  Evidence stored in: ${evidenceNote}`));
        if (type === 'local') {
          console.log(chalk.cyan('  Next: iterate locally, then run aethra audit --local again\n'));
        } else {
          console.log(chalk.cyan('  Next: aethra plan-fix "<task>"\n'));
        }

        if (audit.status === 'failed') process.exit(1);
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`audit failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });
}

/** Print a formatted comparison table to stdout. */
function printComparisonTable(c: AuditComparison): void {
  console.log(chalk.bold('\n  vs Production Baseline\n'));

  if (c.lighthouseDeltas.length > 0) {
    console.log(chalk.bold('  Lighthouse scores\n'));
    const header = '  ┌──────────────────┬──────────┬───────┬─────────┐';
    const divider = '  ├──────────────────┼──────────┼───────┼─────────┤';
    const footer = '  └──────────────────┴──────────┴───────┴─────────┘';

    console.log(header);
    console.log('  │ Category         │ Baseline │ Local │ Delta   │');
    console.log(divider);

    for (const d of c.lighthouseDeltas) {
      const label = d.category.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()).padEnd(16);
      const baseline = d.baseline !== null ? String(d.baseline).padEnd(8) : 'n/a     ';
      const local = d.local !== null ? String(d.local).padEnd(5) : 'n/a  ';
      const deltaStr =
        d.delta === null
          ? 'n/a    '
          : d.delta > 0
          ? chalk.green(`+${d.delta}`.padEnd(7))
          : d.delta < 0
          ? chalk.red(String(d.delta).padEnd(7))
          : '0      ';

      console.log(`  │ ${label} │ ${baseline} │ ${local} │ ${deltaStr} │`);
    }
    console.log(footer);
  }

  console.log(chalk.bold('\n  Findings\n'));

  if (c.findings.resolved.length > 0) {
    console.log(chalk.green(`  ✓ Resolved (${c.findings.resolved.length}):`));
    for (const f of c.findings.resolved) {
      console.log(chalk.green(`    - ${f.title}`));
    }
  }

  if (c.findings.remaining.length > 0) {
    console.log(chalk.yellow(`\n  ● Remaining (${c.findings.remaining.length}):`));
    for (const f of c.findings.remaining) {
      console.log(chalk.yellow(`    - ${f.title}`));
    }
  }

  if (c.findings.newIssues.length > 0) {
    console.log(chalk.red(`\n  + New issues (${c.findings.newIssues.length}):`));
    for (const f of c.findings.newIssues) {
      console.log(chalk.red(`    - ${f.title}`));
    }
  } else {
    console.log(chalk.gray('\n  + New issues: none'));
  }

  if (c.summary.performanceImproved) {
    const perfDelta = c.lighthouseDeltas.find((d) => d.category === 'performance');
    if (perfDelta) {
      console.log(chalk.green(
        `\n  ✓ Performance improved from ${perfDelta.baseline} → ${perfDelta.local}. Keep iterating!`,
      ));
    }
  }

  console.log();
}
