/**
 * `aethra doctor` — system health check for all tools and dependencies.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { checkAllTools, checkPlaywright, checkLighthouse, checkMcpServer } from '../../engine/tools.js';
import { AETHRA_HOME } from '../../config/manager.js';
import { pathExists } from '../../engine/fs.js';
import type { ToolCheck } from '../../core/schemas.js';

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check tool availability, dependencies, and workspace health')
    .option('--json', 'Output results as JSON')
    .action(async (opts, cmd) => {
      // Support --json at command level (also supported at root level)
      const jsonMode = opts.json || cmd.parent?.opts()?.json;

      const checks: ToolCheck[] = [];

      if (!jsonMode) {
        console.log(chalk.bold.blue('\n  Aethra Doctor\n'));
        console.log(chalk.gray('  Checking environment...\n'));
      }

      // Core tools
      const coreTools = await checkAllTools();
      const playwright = await checkPlaywright();
      const lighthouse = await checkLighthouse();
      const mcpBrowser = await checkMcpServer('playwright-mcp', 'playwright-mcp');

      checks.push(...coreTools, playwright, lighthouse, mcpBrowser);

      // Group checks
      const required = checks.filter((c) => c.required);
      const optional = checks.filter((c) => !c.required);

      if (jsonMode) {
        const output = {
          timestamp: new Date().toISOString(),
          environment: {
            os: process.platform,
            nodeVersion: process.version,
            aethraHome: AETHRA_HOME,
            aethraHomeExists: await pathExists(AETHRA_HOME),
          },
          checks,
          summary: {
            total: checks.length,
            ok: checks.filter((c) => c.status === 'ok').length,
            warning: checks.filter((c) => c.status === 'warning').length,
            missing: checks.filter((c) => c.status === 'missing').length,
            error: checks.filter((c) => c.status === 'error').length,
          },
        };
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      // Global config status
      const configExists = await pathExists(AETHRA_HOME);
      const configIcon = configExists ? chalk.green('✓') : chalk.yellow('⚠');
      console.log(`  ${configIcon} Aethra home: ${AETHRA_HOME}`);
      if (!configExists) {
        console.log(chalk.yellow('    → Run: aethra init'));
      }

      // Print required tools
      console.log(chalk.bold('\n  Required tools:\n'));
      for (const check of required) printToolCheck(check);

      // Print optional tools
      console.log(chalk.bold('\n  Optional tools:\n'));
      for (const check of optional) printToolCheck(check);

      // Summary
      const ok = checks.filter((c) => c.status === 'ok').length;
      const warnings = checks.filter((c) => c.status === 'warning').length;
      const missing = checks.filter((c) => c.status === 'missing').length;

      console.log(chalk.bold('\n  Summary:\n'));
      console.log(`  ${chalk.green(`${ok} ok`)}  ${chalk.yellow(`${warnings} warnings`)}  ${chalk.red(`${missing} missing`)}`);

      const requiredMissing = required.filter((c) => c.status === 'missing');
      if (requiredMissing.length > 0) {
        console.log(chalk.red(`\n  ✗ ${requiredMissing.length} required tool(s) missing.\n`));
        process.exit(1);
      } else {
        console.log(chalk.green('\n  ✓ All required tools are available.\n'));
      }
    });
}

function printToolCheck(check: ToolCheck): void {
  const icons: Record<string, string> = {
    ok: chalk.green('✓'),
    warning: chalk.yellow('⚠'),
    missing: chalk.red('✗'),
    error: chalk.red('!'),
  };
  const icon = icons[check.status] ?? '?';
  const versionStr = check.version ? chalk.gray(` ${check.version}`) : '';
  const pathStr = check.path ? chalk.gray(` (${check.path})`) : '';
  const requiredStr = check.required ? '' : chalk.gray(' [optional]');

  console.log(`  ${icon} ${check.name}${versionStr}${pathStr}${requiredStr}`);

  if (check.message) {
    console.log(chalk.gray(`      ${check.message}`));
  }
  if (check.status !== 'ok' && check.installHint) {
    console.log(chalk.gray(`      → ${check.installHint}`));
  }
}
