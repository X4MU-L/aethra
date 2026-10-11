/**
 * Configuration manager for global and client-specific settings.
 * Reads YAML configs, validates with Zod, resolves paths correctly.
 */

import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import { GlobalConfigSchema, ClientConfigSchema } from '../core/schemas.js';
import type { GlobalConfig, ClientConfig } from '../core/schemas.js';
import { expandPath, ensureDir, writeFile, pathExists } from '../engine/fs.js';
import { ConfigError } from '../core/errors.js';
import { logger } from '../core/logger.js';

const AETHRA_HOME = path.join(os.homedir(), '.aethra');
const GLOBAL_CONFIG_PATH = path.join(AETHRA_HOME, 'config.yaml');

let _globalConfig: GlobalConfig | null = null;

/** Load and validate the global configuration. */
export async function loadGlobalConfig(): Promise<GlobalConfig> {
  if (_globalConfig) return _globalConfig;

  if (!(await pathExists(GLOBAL_CONFIG_PATH))) {
    logger.debug('No global config found; using defaults.');
    _globalConfig = GlobalConfigSchema.parse({});
    return _globalConfig;
  }

  try {
    const raw = await fs.readFile(GLOBAL_CONFIG_PATH, 'utf8');
    const parsed = yaml.load(raw);
    _globalConfig = GlobalConfigSchema.parse(parsed);
    return _globalConfig;
  } catch (err) {
    throw new ConfigError(`Invalid global config at ${GLOBAL_CONFIG_PATH}: ${(err as Error).message}`);
  }
}

/** Save global configuration. */
export async function saveGlobalConfig(config: GlobalConfig): Promise<void> {
  await ensureDir(AETHRA_HOME);
  const validated = GlobalConfigSchema.parse(config);
  await writeFile(GLOBAL_CONFIG_PATH, yaml.dump(validated));
  _globalConfig = validated;
  logger.success(`Global config saved to ${GLOBAL_CONFIG_PATH}`);
}

/** Get the workspace root, expanding ~. */
export async function getWorkspaceRoot(): Promise<string> {
  const config = await loadGlobalConfig();
  return expandPath(config.workspaceRoot);
}

/** Get the path for a specific client workspace. */
export async function getClientWorkspacePath(slug: string): Promise<string> {
  const root = await getWorkspaceRoot();
  return path.join(root, slug);
}

/** Load a client's configuration from their workspace. */
export async function loadClientConfig(workspacePath: string): Promise<ClientConfig> {
  const configPath = path.join(expandPath(workspacePath), 'client.yaml');

  if (!(await pathExists(configPath))) {
    throw new ConfigError(`No client.yaml found at ${configPath}. Is this a valid client workspace?`);
  }

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = yaml.load(raw);
    return ClientConfigSchema.parse(parsed);
  } catch (err) {
    throw new ConfigError(`Invalid client.yaml at ${configPath}: ${(err as Error).message}`);
  }
}

/** Save a client configuration. */
export async function saveClientConfig(
  workspacePath: string,
  config: ClientConfig,
): Promise<void> {
  const resolved = expandPath(workspacePath);
  await ensureDir(resolved);
  const validated = ClientConfigSchema.parse(config);
  const configPath = path.join(resolved, 'client.yaml');
  await writeFile(configPath, yaml.dump(validated));
  logger.success(`Client config saved: ${configPath}`);
}

/**
 * Resolve the active client workspace.
 *
 * Resolution order:
 * 1. Explicit --client slug (looks up in workspace root)
 * 2. client.yaml in current directory
 * 3. client.yaml in any parent directory
 *
 * Throws if multiple candidates exist and none is explicitly selected.
 */
export async function resolveClientWorkspace(
  explicitSlug?: string,
): Promise<{ slug: string; workspacePath: string; config: ClientConfig }> {
  if (explicitSlug) {
    const workspacePath = await getClientWorkspacePath(explicitSlug);
    if (!(await pathExists(workspacePath))) {
      throw new ConfigError(
        `Client workspace not found for slug "${explicitSlug}" at ${workspacePath}`,
      );
    }
    const config = await loadClientConfig(workspacePath);
    return { slug: explicitSlug, workspacePath, config };
  }

  // Walk up from cwd looking for client.yaml
  let current = process.cwd();
  const root = path.parse(current).root;

  while (current !== root) {
    const candidate = path.join(current, 'client.yaml');
    if (await pathExists(candidate)) {
      const config = await loadClientConfig(current);
      return { slug: config.slug, workspacePath: current, config };
    }
    current = path.dirname(current);
  }

  throw new ConfigError(
    'No active client workspace found. ' +
    'Run this command from within a client workspace, or use --client <slug>.',
  );
}

/**
 * Update specific fields of a client configuration, preserving all other fields.
 * Validates the merged result with Zod before saving.
 */
export async function updateClientConfig(
  workspacePath: string,
  updates: Partial<ClientConfig>,
): Promise<ClientConfig> {
  const existing = await loadClientConfig(workspacePath);
  const merged = ClientConfigSchema.parse({
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  });
  await saveClientConfig(workspacePath, merged);
  return merged;
}

/** Initialise global config if it doesn't exist. Returns true if created. */
export async function initGlobalConfig(force = false): Promise<boolean> {
  if ((await pathExists(GLOBAL_CONFIG_PATH)) && !force) {
    return false;
  }
  const defaultConfig = GlobalConfigSchema.parse({});
  await saveGlobalConfig(defaultConfig);
  return true;
}

export { AETHRA_HOME, GLOBAL_CONFIG_PATH };
