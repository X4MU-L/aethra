/**
 * Git inspection and branch management engine.
 * Safety-first: never destructively resets, force-pushes, or discards uncommitted work.
 */

import path from 'path';
import { run, queryOutput } from './subprocess.js';
import { logger } from '../core/logger.js';
import { WorkspaceError } from '../core/errors.js';

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  hasUncommittedChanges: boolean;
  untrackedFiles: string[];
  modifiedFiles: string[];
  stagedFiles: string[];
  aheadCount: number;
  behindCount: number;
  remoteUrl: string | null;
}

/** Get the current git status of a directory. */
export async function getGitStatus(cwd: string): Promise<GitStatus> {
  const isRepo = await isGitRepo(cwd);
  if (!isRepo) {
    return {
      isRepo: false,
      branch: null,
      hasUncommittedChanges: false,
      untrackedFiles: [],
      modifiedFiles: [],
      stagedFiles: [],
      aheadCount: 0,
      behindCount: 0,
      remoteUrl: null,
    };
  }

  // Use run() directly for status to preserve leading whitespace in porcelain format
  const [branch, statusResult, remoteUrl] = await Promise.all([
    queryOutput('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd }),
    run('git', ['status', '--porcelain', '-u'], { cwd, allowFailure: true }),
    queryOutput('git', ['remote', 'get-url', 'origin'], { cwd }),
  ]);
  const statusOutput = statusResult.stdout;

  const lines = (statusOutput ?? '').split('\n').filter(Boolean);
  const untrackedFiles: string[] = [];
  const modifiedFiles: string[] = [];
  const stagedFiles: string[] = [];

  for (const line of lines) {
    const staged = line[0];
    const unstaged = line[1];
    const file = line.slice(3).trim();

    if (staged === '?' && unstaged === '?') untrackedFiles.push(file);
    else {
      if (unstaged === 'M' || unstaged === 'D') modifiedFiles.push(file);
      if (staged === 'M' || staged === 'A' || staged === 'D' || staged === 'R') {
        stagedFiles.push(file);
      }
    }
  }

  // Get ahead/behind counts
  let aheadCount = 0;
  let behindCount = 0;
  try {
    const revList = await queryOutput(
      'git',
      ['rev-list', '--left-right', '--count', `HEAD...@{upstream}`],
      { cwd },
    );
    if (revList) {
      const parts = revList.split('\t');
      aheadCount = parseInt(parts[0] ?? '0', 10) || 0;
      behindCount = parseInt(parts[1] ?? '0', 10) || 0;
    }
  } catch {
    // No upstream configured
  }

  const hasUncommittedChanges =
    untrackedFiles.length > 0 || modifiedFiles.length > 0 || stagedFiles.length > 0;

  return {
    isRepo: true,
    branch: branch ?? null,
    hasUncommittedChanges,
    untrackedFiles,
    modifiedFiles,
    stagedFiles,
    aheadCount,
    behindCount,
    remoteUrl: remoteUrl ?? null,
  };
}

/** Check if a directory is a git repository. */
export async function isGitRepo(cwd: string): Promise<boolean> {
  const result = await queryOutput('git', ['rev-parse', '--git-dir'], { cwd });
  return result !== null;
}

/** Get the root of the git repo containing cwd. */
export async function getRepoRoot(cwd: string): Promise<string | null> {
  return queryOutput('git', ['rev-parse', '--show-toplevel'], { cwd });
}

/**
 * Create a feature branch safely.
 * Refuses if there are uncommitted changes that would be lost.
 */
export async function createFeatureBranch(
  branchName: string,
  cwd: string,
): Promise<void> {
  const status = await getGitStatus(cwd);
  if (!status.isRepo) {
    throw new WorkspaceError(`Not a git repository: ${cwd}`);
  }

  // Sanitise branch name
  const safeName = branchName.replace(/[^a-zA-Z0-9/_-]/g, '-').replace(/--+/g, '-');

  // Check if branch already exists
  const existing = await queryOutput('git', ['branch', '--list', safeName], { cwd });
  if (existing && existing.trim()) {
    logger.warn(`Branch already exists: ${safeName}. Checking it out.`);
    await run('git', ['checkout', safeName], { cwd });
    return;
  }

  await run('git', ['checkout', '-b', safeName], { cwd });
  logger.success(`Created branch: ${safeName}`);
}

/** Get the current branch name. */
export async function getCurrentBranch(cwd: string): Promise<string | null> {
  return queryOutput('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
}

/** Get recent commit messages. */
export async function getRecentCommits(
  cwd: string,
  count = 10,
): Promise<Array<{ hash: string; message: string; date: string }>> {
  const out = await queryOutput(
    'git',
    ['log', `--max-count=${count}`, '--pretty=format:%H|%s|%ai'],
    { cwd },
  );
  if (!out) return [];
  return out.split('\n').filter(Boolean).map((line) => {
    const [hash = '', message = '', date = ''] = line.split('|');
    return { hash, message, date };
  });
}

/** Get a git diff for the working tree. */
export async function getDiff(cwd: string, staged = false): Promise<string> {
  const args = staged ? ['diff', '--cached'] : ['diff'];
  const out = await queryOutput('git', args, { cwd });
  return out ?? '';
}

/** Check if a specific file has been modified. */
export async function isFileModified(filePath: string, cwd: string): Promise<boolean> {
  const rel = path.relative(cwd, filePath);
  const out = await queryOutput('git', ['status', '--porcelain', rel], { cwd });
  return !!out && out.trim().length > 0;
}
