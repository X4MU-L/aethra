/**
 * Tests for the Git engine.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { execaSync } from 'execa';
import { getGitStatus, isGitRepo, getRepoRoot } from '../../src/engine/git.js';

// macOS: /var is a symlink to /private/var — resolve to real path for comparisons
async function realTmpDir(): Promise<string> {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aethra-git-test-')));
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await realTmpDir();
});

afterEach(async () => {
  await fs.remove(tmpDir);
});

async function initGitRepo(dir: string): Promise<void> {
  execaSync('git', ['init'], { cwd: dir });
  execaSync('git', ['config', 'user.email', 'test@aethra.test'], { cwd: dir });
  execaSync('git', ['config', 'user.name', 'Aethra Test'], { cwd: dir });
}

describe('isGitRepo', () => {
  it('returns false for a non-git directory', async () => {
    expect(await isGitRepo(tmpDir)).toBe(false);
  });

  it('returns true for an initialised git repo', async () => {
    await initGitRepo(tmpDir);
    expect(await isGitRepo(tmpDir)).toBe(true);
  });
});

describe('getGitStatus', () => {
  it('returns isRepo:false for non-git directory', async () => {
    const status = await getGitStatus(tmpDir);
    expect(status.isRepo).toBe(false);
    expect(status.branch).toBeNull();
    expect(status.hasUncommittedChanges).toBe(false);
  });

  it('returns correct status for a clean git repo', async () => {
    await initGitRepo(tmpDir);
    // Create and commit a file
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# Test');
    execaSync('git', ['add', '.'], { cwd: tmpDir });
    execaSync('git', ['commit', '-m', 'Initial commit'], { cwd: tmpDir });

    const status = await getGitStatus(tmpDir);
    expect(status.isRepo).toBe(true);
    expect(status.hasUncommittedChanges).toBe(false);
    expect(status.modifiedFiles).toHaveLength(0);
    expect(status.untrackedFiles).toHaveLength(0);
  });

  it('detects untracked files', async () => {
    await initGitRepo(tmpDir);
    await fs.writeFile(path.join(tmpDir, 'new-file.txt'), 'content');

    const status = await getGitStatus(tmpDir);
    expect(status.hasUncommittedChanges).toBe(true);
    expect(status.untrackedFiles).toContain('new-file.txt');
  });

  it('detects modified files', async () => {
    await initGitRepo(tmpDir);
    const filePath = path.join(tmpDir, 'file.txt');
    await fs.writeFile(filePath, 'original');
    execaSync('git', ['add', '.'], { cwd: tmpDir });
    execaSync('git', ['commit', '-m', 'Add file'], { cwd: tmpDir });
    await fs.writeFile(filePath, 'modified');

    const status = await getGitStatus(tmpDir);
    expect(status.hasUncommittedChanges).toBe(true);
    // Modified unstaged files appear in modifiedFiles
    expect(status.modifiedFiles).toContain('file.txt');
  });
});

describe('getRepoRoot', () => {
  it('returns null for non-git directory', async () => {
    const root = await getRepoRoot(tmpDir);
    expect(root).toBeNull();
  });

  it('returns the repo root for a git directory', async () => {
    await initGitRepo(tmpDir);
    const root = await getRepoRoot(tmpDir);
    // On macOS /var → /private/var; normalise both paths
    const normalRoot = root ? await fs.realpath(root).catch(() => root) : null;
    expect(normalRoot).toBe(tmpDir);
  });

  it('finds root from a subdirectory', async () => {
    await initGitRepo(tmpDir);
    const subDir = path.join(tmpDir, 'src', 'lib');
    await fs.ensureDir(subDir);
    const root = await getRepoRoot(subDir);
    const normalRoot = root ? await fs.realpath(root).catch(() => root) : null;
    expect(normalRoot).toBe(tmpDir);
  });
});
