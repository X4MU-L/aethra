#!/usr/bin/env node
/**
 * Aethra CLI entry point.
 * Parses global flags and delegates to subcommands.
 */

import { Command } from 'commander';
import { setLogLevel, setJsonMode } from '../core/logger.js';
import { toAethraError } from '../core/errors.js';

const program = new Command();

program
  .name('aethra')
  .description('Aethra Client Engineering Workbench — local developer platform for client project delivery')
  .version('0.1.0')
  .option('-v, --verbose', 'Enable verbose/debug logging')
  .option('--json', 'Output machine-readable JSON')
  .option('--client <slug>', 'Explicitly select a client workspace by slug')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) setLogLevel('debug');
    if (opts.json) setJsonMode(true);
  });

// Lazy-load commands to keep startup fast
async function loadCommands(): Promise<void> {
  const [
    { registerInitCommand },
    { registerDoctorCommand },
    { registerSetupClientCommand },
    { registerAuditCommand },
    { registerPlanFixCommand },
    { registerApplyFixCommand },
    { registerVerifyCommand },
    { registerReportCommand },
    { registerSkillsCommand },
    { registerToolsCommand },
    { registerPlatformCommand },
    { registerWorkspaceCommand },
    { registerMcpCommand },
    { registerTaskCommand },
    { registerInvestigateCommand },
  ] = await Promise.all([
    import('./commands/init.js'),
    import('./commands/doctor.js'),
    import('./commands/setup-client.js'),
    import('./commands/audit.js'),
    import('./commands/plan-fix.js'),
    import('./commands/apply-fix.js'),
    import('./commands/verify.js'),
    import('./commands/report.js'),
    import('./commands/skills.js'),
    import('./commands/tools.js'),
    import('./commands/platform.js'),
    import('./commands/workspace.js'),
    import('./commands/mcp.js'),
    import('./commands/task.js'),
    import('./commands/investigate.js'),
  ]);

  registerInitCommand(program);
  registerDoctorCommand(program);
  registerSetupClientCommand(program);
  registerAuditCommand(program);
  registerPlanFixCommand(program);
  registerApplyFixCommand(program);
  registerVerifyCommand(program);
  registerReportCommand(program);
  registerSkillsCommand(program);
  registerToolsCommand(program);
  registerPlatformCommand(program);
  registerWorkspaceCommand(program);
  registerMcpCommand(program);
  registerTaskCommand(program);
  registerInvestigateCommand(program);
}

async function main(): Promise<void> {
  try {
    await loadCommands();
    await program.parseAsync(process.argv);
  } catch (err) {
    const aethraErr = toAethraError(err);
    console.error(`\nError [${aethraErr.code}]: ${aethraErr.message}`);
    if (aethraErr.details) {
      console.error('Details:', JSON.stringify(aethraErr.details, null, 2));
    }
    process.exit(aethraErr.exitCode);
  }
}

main();
