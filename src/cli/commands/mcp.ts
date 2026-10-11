/**
 * `aethra mcp` — MCP server management for Claude Code integration.
 */

import type { Command } from 'commander';
import path from 'path';
import chalk from 'chalk';
import { resolveClientWorkspace } from '../../config/manager.js';
import { toAethraError } from '../../core/errors.js';

export function registerMcpCommand(program: Command): void {
  const mcp = program
    .command('mcp')
    .description('MCP server integration with Claude Code');

  mcp
    .command('config')
    .description('Print the Claude Code MCP configuration snippet for this workspace')
    .option('--client <slug>', 'Specify client by slug')
    .action(async (opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;

      try {
        const { config, workspacePath } = await resolveClientWorkspace(clientSlug);

        // Determine where aethra-mcp will be after build
        // Resolved from package root rather than deriving from client workspace path
        const { fileURLToPath } = await import("node:url");
        const thisDir = path.dirname(fileURLToPath(import.meta.url));
        const packageRoot = path.resolve(thisDir, "..", "..", "..");
        const mcpServerPath = path.join(packageRoot, "dist", "mcp", "server.js");

        const mcpConfig = {
          mcpServers: {
            aethra: {
              command: "node",
              args: [mcpServerPath, "--workspace", workspacePath],
              env: {
                AETHRA_WORKSPACE: workspacePath,
              },
            },
          },
        };

        console.log(chalk.bold.blue('\n  Aethra MCP Configuration\n'));
        console.log(chalk.gray(`  Client: ${config.name}`));
        console.log(chalk.gray(`  Workspace: ${workspacePath}\n`));

        console.log(chalk.bold('  Add to your Claude Code MCP settings (claude mcp add or .claude/settings.json):\n'));
        console.log(chalk.cyan(JSON.stringify(mcpConfig, null, 2)));

        console.log(chalk.bold('\n  Or run directly:\n'));
        console.log(chalk.cyan(`  AETHRA_WORKSPACE="${workspacePath}" aethra-mcp\n`));

        console.log(chalk.bold('  Available MCP tools:\n'));
        const tools = [
          'aethra_get_client_config    — Get structured client configuration',
          'aethra_get_client_facts     — Get business facts and objectives',
          'aethra_get_workspace_status — Get onboarding stage and workspace state',
          'aethra_get_latest_audit     — Get audit findings and evidence',
          'aethra_list_plans           — List implementation plans',
          'aethra_get_plan             — Get full plan details',
          'aethra_list_evidence        — List all collected evidence artifacts',
          'aethra_get_knowledge        — Read knowledge base files',
        ];
        for (const tool of tools) console.log(chalk.gray(`  • ${tool}`));
        console.log();
      } catch (err) {
        const e = toAethraError(err);
        console.error(`Error: ${e.message}`);
        process.exit(e.exitCode);
      }
    });

  mcp
    .command('start')
    .description('Start the MCP server for the active workspace (stdio transport)')
    .option('--client <slug>', 'Specify client by slug')
    .action(async (opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.parent?.opts()?.client;

      try {
        const { workspacePath } = await resolveClientWorkspace(clientSlug);
        process.env['AETHRA_WORKSPACE'] = workspacePath;

        // Dynamically import and start the MCP server
        await import('../../mcp/server.js');
      } catch (err) {
        const e = toAethraError(err);
        process.stderr.write(`Error: ${e.message}\n`);
        process.exit(e.exitCode);
      }
    });
}
