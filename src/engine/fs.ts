/**
 * Filesystem operations engine.
 * All file and directory interactions go through here for consistent
 * error handling, safety checks and logging.
 */

import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { logger } from '../core/logger.js';
import { WorkspaceError } from '../core/errors.js';

/** Expand `~` to the user's home directory. */
export function expandPath(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/** Resolve a path after expanding tilde. */
export function resolvePath(...parts: string[]): string {
  const joined = parts.join(path.sep);
  return path.resolve(expandPath(joined));
}

/** Ensure a directory exists, creating it (and parents) if needed. */
export async function ensureDir(dirPath: string): Promise<void> {
  const resolved = expandPath(dirPath);
  await fs.ensureDir(resolved);
  logger.debug(`ensureDir: ${resolved}`);
}

/** Ensure multiple directories exist. */
export async function ensureDirs(dirs: string[]): Promise<void> {
  await Promise.all(dirs.map(ensureDir));
}

/** Write a file safely, refusing to overwrite unless explicitly permitted. */
export async function writeFileSafe(
  filePath: string,
  content: string,
  opts: { overwrite?: boolean; backup?: boolean } = {},
): Promise<void> {
  const resolved = expandPath(filePath);
  const exists = await fs.pathExists(resolved);

  if (exists && !opts.overwrite) {
    throw new WorkspaceError(
      `File already exists: ${resolved}. Use overwrite:true to replace it.`,
    );
  }

  if (exists && opts.backup) {
    const backupPath = `${resolved}.bak.${Date.now()}`;
    await fs.copy(resolved, backupPath);
    logger.info(`Backed up ${resolved} → ${backupPath}`);
  }

  await fs.ensureDir(path.dirname(resolved));
  await fs.writeFile(resolved, content, 'utf8');
  logger.debug(`Wrote ${resolved}`);
}

/** Write a file, creating parent dirs. Overwrites if exists. */
export async function writeFile(filePath: string, content: string): Promise<void> {
  const resolved = expandPath(filePath);
  await fs.ensureDir(path.dirname(resolved));
  await fs.writeFile(resolved, content, 'utf8');
}

/** Write JSON to a file with pretty-printing. */
export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n');
}

/** Read a file as a string. */
export async function readFile(filePath: string): Promise<string> {
  const resolved = expandPath(filePath);
  if (!(await fs.pathExists(resolved))) {
    throw new WorkspaceError(`File not found: ${resolved}`);
  }
  return fs.readFile(resolved, 'utf8');
}

/** Read a JSON file and parse it. */
export async function readJson<T = unknown>(filePath: string): Promise<T> {
  const content = await readFile(filePath);
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new WorkspaceError(`Invalid JSON in ${filePath}`);
  }
}

/** Check if a path exists. */
export async function pathExists(p: string): Promise<boolean> {
  return fs.pathExists(expandPath(p));
}

/** List files in a directory (non-recursive). */
export async function listDir(dirPath: string): Promise<string[]> {
  const resolved = expandPath(dirPath);
  if (!(await fs.pathExists(resolved))) return [];
  const entries = await fs.readdir(resolved);
  return entries;
}

/** Copy a file or directory. */
export async function copy(src: string, dest: string): Promise<void> {
  await fs.copy(expandPath(src), expandPath(dest));
}

/** Move a file or directory. */
export async function move(src: string, dest: string): Promise<void> {
  await fs.move(expandPath(src), expandPath(dest));
}

/** Remove a path (file or directory). Use with extreme caution. */
export async function remove(p: string): Promise<void> {
  const resolved = expandPath(p);
  logger.warn(`Removing: ${resolved}`);
  await fs.remove(resolved);
}

/** Get file stats. */
export async function stat(p: string): Promise<fs.Stats | null> {
  try {
    return await fs.stat(expandPath(p));
  } catch {
    return null;
  }
}

/** Find files matching a glob pattern within a directory. */
export async function findFiles(
  dir: string,
  pattern: RegExp,
  maxDepth = 3,
): Promise<string[]> {
  const resolved = expandPath(dir);
  const results: string[] = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = await fs.readdir(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      const full = path.join(current, entry);
      const s = await stat(full);
      if (!s) continue;
      if (s.isDirectory()) {
        await walk(full, depth + 1);
      } else if (pattern.test(entry)) {
        results.push(full);
      }
    }
  }

  await walk(resolved, 0);
  return results;
}

/** Create a timestamped directory name. */
export function timestampedName(prefix: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${prefix}-${ts}`;
}
