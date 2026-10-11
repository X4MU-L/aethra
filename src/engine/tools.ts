/**
 * Tool detection engine — checks installed CLIs, runtimes and services.
 * Never conflates CLI presence with authenticated/working service access.
 */

import { commandExists, getVersion, queryOutput } from './subprocess.js';
import type { ToolCheck } from '../core/schemas.js';

interface ToolDefinition {
  name: string;
  command: string;
  required: boolean;
  versionFlag?: string;
  installHint: string;
  postCheck?: () => Promise<string | null>; // Extra info or warning
}

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'Node.js',
    command: 'node',
    required: true,
    versionFlag: '--version',
    installHint: 'Install from https://nodejs.org or via nvm',
  },
  {
    name: 'npm',
    command: 'npm',
    required: true,
    versionFlag: '--version',
    installHint: 'Comes bundled with Node.js',
  },
  {
    name: 'pnpm',
    command: 'pnpm',
    required: false,
    versionFlag: '--version',
    installHint: 'npm install -g pnpm',
  },
  {
    name: 'Git',
    command: 'git',
    required: true,
    versionFlag: '--version',
    installHint: 'Install via Xcode Command Line Tools: xcode-select --install',
  },
  {
    name: 'Docker',
    command: 'docker',
    required: false,
    versionFlag: '--version',
    installHint: 'Install Docker Desktop from https://docker.com',
    postCheck: async () => {
      const running = await queryOutput('docker', ['info'], { timeoutMs: 5000 });
      if (!running) return 'Docker is installed but the daemon may not be running';
      return null;
    },
  },
  {
    name: 'DDEV',
    command: 'ddev',
    required: false,
    versionFlag: 'version',
    installHint: 'Install from https://ddev.com/get-started/',
  },
  {
    name: 'Claude Code',
    command: 'claude',
    required: false,
    versionFlag: '--version',
    installHint: 'npm install -g @anthropic-ai/claude-code',
    postCheck: async () => {
      // Presence of CLI does not imply authenticated session
      return 'Note: CLI presence does not verify authentication or subscription status';
    },
  },
  {
    name: 'Shopify CLI',
    command: 'shopify',
    required: false,
    versionFlag: 'version',
    installHint: 'npm install -g @shopify/cli',
  },
  {
    name: 'WP-CLI',
    command: 'wp',
    required: false,
    versionFlag: '--version',
    installHint: 'Install from https://wp-cli.org/#installing',
  },
  {
    name: 'LocalWP CLI (localwp)',
    command: 'localwp',
    required: false,
    versionFlag: '--version',
    installHint: 'Available via LocalWP app installation: https://localwp.com',
  },
  {
    name: 'Python 3',
    command: 'python3',
    required: false,
    versionFlag: '--version',
    installHint: 'Install from https://python.org or via pyenv',
  },
  {
    name: 'Bun',
    command: 'bun',
    required: false,
    versionFlag: '--version',
    installHint: 'curl -fsSL https://bun.sh/install | bash',
  },
];

/** Check a single tool and return a ToolCheck result. */
export async function checkTool(def: ToolDefinition): Promise<ToolCheck> {
  const exists = await commandExists(def.command);

  if (!exists) {
    return {
      name: def.name,
      required: def.required,
      status: def.required ? 'missing' : 'warning',
      message: `Not found on PATH`,
      installHint: def.installHint,
    };
  }

  const version = await getVersion(def.command, def.versionFlag ?? '--version');
  let message: string | undefined;

  if (def.postCheck) {
    const warning = await def.postCheck();
    if (warning) message = warning;
  }

  // Get path
  const pathOut = await queryOutput('which', [def.command]);

  return {
    name: def.name,
    required: def.required,
    status: 'ok',
    version: version ?? undefined,
    path: pathOut ?? undefined,
    message,
  };
}

/** Run all tool checks. */
export async function checkAllTools(): Promise<ToolCheck[]> {
  const results = await Promise.all(TOOL_DEFINITIONS.map(checkTool));
  return results;
}

/** Check Playwright browser availability. */
export async function checkPlaywright(): Promise<ToolCheck> {
  // Check if playwright package is resolvable
  try {
    const { chromium } = await import('playwright');
    // Try to get browser path
    const executablePath = chromium.executablePath();
    const fs = await import('fs-extra');
    const browserInstalled = await fs.default.pathExists(executablePath);

    return {
      name: 'Playwright (Chromium)',
      required: false,
      status: browserInstalled ? 'ok' : 'warning',
      message: browserInstalled
        ? `Browser at ${executablePath}`
        : 'Playwright installed but browser not downloaded. Run: npx playwright install chromium',
      installHint: 'npx playwright install chromium',
    };
  } catch {
    return {
      name: 'Playwright (Chromium)',
      required: false,
      status: 'warning',
      message: 'Playwright not installed in this project',
      installHint: 'npm install playwright && npx playwright install chromium',
    };
  }
}

/** Check Lighthouse availability. */
export async function checkLighthouse(): Promise<ToolCheck> {
  const exists = await commandExists('lighthouse');
  if (!exists) {
    // Check if it's available via npx
    const version = await queryOutput('npx', ['lighthouse', '--version'], { timeoutMs: 10000 });
    if (version) {
      return {
        name: 'Lighthouse',
        required: false,
        status: 'ok',
        version,
        message: 'Available via npx',
      };
    }
    return {
      name: 'Lighthouse',
      required: false,
      status: 'warning',
      message: 'Not installed globally (can use npx)',
      installHint: 'npm install -g lighthouse',
    };
  }
  const version = await getVersion('lighthouse');
  return {
    name: 'Lighthouse',
    required: false,
    status: 'ok',
    version: version ?? undefined,
  };
}

/** Check MCP server availability for a given command. */
export async function checkMcpServer(name: string, command: string): Promise<ToolCheck> {
  const exists = await commandExists(command);
  return {
    name: `MCP: ${name}`,
    required: false,
    status: exists ? 'ok' : 'warning',
    message: exists ? undefined : `MCP server "${name}" not found`,
    installHint: `See Aethra docs for ${name} MCP setup`,
  };
}
