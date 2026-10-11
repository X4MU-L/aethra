/**
 * `aethra tools` — list and check available tools.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { checkAllTools, checkPlaywright, checkLighthouse } from '../../engine/tools.js';

export function registerToolsCommand(program: Command): void {
  const tools = program
    .command('tools')
    .description('Manage and check available tools');

  tools
    .command('list')
    .description('List all configured tools')
    .action(async () => {
      const allTools = await checkAllTools();
      console.log(chalk.bold.blue('\n  Configured tools\n'));
      for (const tool of allTools) {
        const req = tool.required ? '' : chalk.gray(' [optional]');
        console.log(`  ${tool.name}${req}${tool.version ? chalk.gray(` — ${tool.version}`) : ''}`);
        if (tool.installHint) console.log(chalk.gray(`    Install: ${tool.installHint}`));
      }
    });

  tools
    .command('check')
    .description('Check health of all tools')
    .option('--json', 'Output as JSON')
    .action(async (opts, cmd) => {
      const jsonMode = opts.json || cmd.parent?.parent?.opts()?.json;
      const allTools = await checkAllTools();
      const playwright = await checkPlaywright();
      const lighthouse = await checkLighthouse();
      const checks = [...allTools, playwright, lighthouse];

      if (jsonMode) {
        console.log(JSON.stringify(checks, null, 2));
        return;
      }

      console.log(chalk.bold.blue('\n  Tool health check\n'));
      for (const check of checks) {
        const icons: Record<string, string> = {
          ok: chalk.green('✓'),
          warning: chalk.yellow('⚠'),
          missing: chalk.red('✗'),
          error: chalk.red('!'),
        };
        const icon = icons[check.status] ?? '?';
        console.log(`  ${icon} ${check.name}${check.version ? chalk.gray(` ${check.version}`) : ''}`);
        if (check.message) console.log(chalk.gray(`      ${check.message}`));
        if (check.status !== 'ok' && check.installHint) {
          console.log(chalk.gray(`      → ${check.installHint}`));
        }
      }
      console.log();
    });
}
