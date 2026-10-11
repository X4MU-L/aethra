/**
 * Tests for the task lifecycle engine (src/engine/tasks.ts).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  createTask,
  loadTask,
  saveTask,
  updateTask,
  transitionTask,
  listTasks,
  findTaskByPrefix,
} from '../../src/engine/tasks.js';
import { closeDb } from '../../src/engine/db.js';

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aethra-tasks-test-'));
  // Create the .local directory so getDb() can create aethra.db inside it
  await fs.mkdir(path.join(tmpDir, '.local'), { recursive: true });
});

afterAll(async () => {
  closeDb(tmpDir);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ─── createTask ───────────────────────────────────────────────────────────────

describe('createTask', () => {
  it('creates a task persisted in the database', async () => {
    const task = await createTask(tmpDir, 'plan-abc', '/plans/plan-abc.json', 'Fix nav', 'test-co');

    expect(task.id).toHaveLength(16); // 8 bytes hex
    expect(task.status).toBe('planned');
    expect(task.planId).toBe('plan-abc');
    expect(task.planPath).toBe('/plans/plan-abc.json');
    expect(task.title).toBe('Fix nav');
    expect(task.clientSlug).toBe('test-co');

    // Verify persistence via loadTask
    const loaded = await loadTask(tmpDir, task.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(task.id);
  });

  it('each call produces a distinct task ID', async () => {
    const a = await createTask(tmpDir, 'plan-1', '/p1.json', 'Task 1', 'co');
    const b = await createTask(tmpDir, 'plan-2', '/p2.json', 'Task 2', 'co');
    expect(a.id).not.toBe(b.id);
  });
});

// ─── loadTask ─────────────────────────────────────────────────────────────────

describe('loadTask', () => {
  it('loads an existing task by full ID', async () => {
    const created = await createTask(tmpDir, 'plan-x', '/x.json', 'Load test', 'co');
    const loaded = await loadTask(tmpDir, created.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(created.id);
  });

  it('returns null for a non-existent task ID', async () => {
    const result = await loadTask(tmpDir, 'nonexistent-id-0000');
    expect(result).toBeNull();
  });
});

// ─── updateTask ───────────────────────────────────────────────────────────────

describe('updateTask', () => {
  it('merges updates and persists to disk', async () => {
    const task = await createTask(tmpDir, 'plan-upd', '/upd.json', 'Update test', 'co');
    const updated = await updateTask(tmpDir, task.id, { notes: 'test note', gitBranch: 'aethra/fix' });

    expect(updated.notes).toBe('test note');
    expect(updated.gitBranch).toBe('aethra/fix');

    // Re-load confirms persistence
    const reloaded = await loadTask(tmpDir, task.id);
    expect(reloaded!.notes).toBe('test note');
  });

  it('throws when the task ID does not exist', async () => {
    await expect(
      updateTask(tmpDir, 'does-not-exist', { notes: 'x' }),
    ).rejects.toThrow('Task not found');
  });
});

// ─── transitionTask ───────────────────────────────────────────────────────────

describe('transitionTask', () => {
  it('planned → approved sets approvedAt', async () => {
    const task = await createTask(tmpDir, 'plan-tr1', '/tr1.json', 'Transition 1', 'co');
    const approved = await transitionTask(tmpDir, task.id, 'approved', {
      approvedBy: 'ebuka',
      approvedAt: new Date().toISOString(),
    });

    expect(approved.status).toBe('approved');
    expect(approved.approvedBy).toBe('ebuka');
  });

  it('approved → in-progress sets startedAt', async () => {
    const task = await createTask(tmpDir, 'plan-tr2', '/tr2.json', 'Transition 2', 'co');
    await transitionTask(tmpDir, task.id, 'approved');
    const started = await transitionTask(tmpDir, task.id, 'in-progress');

    expect(started.status).toBe('in-progress');
    expect(started.startedAt).toBeDefined();
  });

  it('in-progress → verifying is valid', async () => {
    const task = await createTask(tmpDir, 'plan-tr3', '/tr3.json', 'Transition 3', 'co');
    await transitionTask(tmpDir, task.id, 'approved');
    await transitionTask(tmpDir, task.id, 'in-progress');
    const verifying = await transitionTask(tmpDir, task.id, 'verifying');

    expect(verifying.status).toBe('verifying');
  });

  it('verifying → completed sets completedAt', async () => {
    const task = await createTask(tmpDir, 'plan-tr4', '/tr4.json', 'Transition 4', 'co');
    await transitionTask(tmpDir, task.id, 'approved');
    await transitionTask(tmpDir, task.id, 'in-progress');
    await transitionTask(tmpDir, task.id, 'verifying');
    const completed = await transitionTask(tmpDir, task.id, 'completed');

    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBeDefined();
  });

  it('throws on an invalid transition (planned → completed)', async () => {
    const task = await createTask(tmpDir, 'plan-bad', '/bad.json', 'Bad transition', 'co');
    await expect(
      transitionTask(tmpDir, task.id, 'completed'),
    ).rejects.toThrow(/Invalid status transition/);
  });

  it('completed → anything is rejected', async () => {
    const task = await createTask(tmpDir, 'plan-done', '/done.json', 'Done task', 'co');
    await transitionTask(tmpDir, task.id, 'approved');
    await transitionTask(tmpDir, task.id, 'in-progress');
    await transitionTask(tmpDir, task.id, 'verifying');
    await transitionTask(tmpDir, task.id, 'completed');

    await expect(
      transitionTask(tmpDir, task.id, 'in-progress'),
    ).rejects.toThrow(/Invalid status transition/);
  });

  it('throws when task does not exist', async () => {
    await expect(
      transitionTask(tmpDir, 'ghost-task-id', 'approved'),
    ).rejects.toThrow('Task not found');
  });
});

// ─── listTasks ────────────────────────────────────────────────────────────────

describe('listTasks', () => {
  it('returns all tasks sorted newest first', async () => {
    // Create a fresh isolated workspace for list tests
    const listTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aethra-tasks-list-'));
    await fs.mkdir(path.join(listTmpDir, '.local'), { recursive: true });

    const a = await createTask(listTmpDir, 'p1', '/p1.json', 'First task', 'co');
    // Slight delay to ensure different createdAt
    await new Promise((r) => setTimeout(r, 10));
    const b = await createTask(listTmpDir, 'p2', '/p2.json', 'Second task', 'co');

    const tasks = await listTasks(listTmpDir);
    expect(tasks.length).toBe(2);
    // Sorted newest-first
    expect(tasks[0]!.id).toBe(b.id);
    expect(tasks[1]!.id).toBe(a.id);

    closeDb(listTmpDir);
    await fs.rm(listTmpDir, { recursive: true, force: true });
  });

  it('returns empty array when no tasks exist', async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aethra-tasks-empty-'));
    await fs.mkdir(path.join(emptyDir, '.local'), { recursive: true });
    const tasks = await listTasks(emptyDir);
    expect(tasks).toEqual([]);
    closeDb(emptyDir);
    await fs.rm(emptyDir, { recursive: true, force: true });
  });
});

// ─── findTaskByPrefix ─────────────────────────────────────────────────────────

describe('findTaskByPrefix', () => {
  it('finds a task by 8-char prefix', async () => {
    const task = await createTask(tmpDir, 'plan-pf', '/pf.json', 'Prefix find', 'co');
    const found = await findTaskByPrefix(tmpDir, task.id.slice(0, 8));
    expect(found).not.toBeNull();
    expect(found!.id).toBe(task.id);
  });

  it('finds a task by full ID', async () => {
    const task = await createTask(tmpDir, 'plan-full', '/full.json', 'Full ID find', 'co');
    const found = await findTaskByPrefix(tmpDir, task.id);
    expect(found!.id).toBe(task.id);
  });

  it('returns null when no task matches the prefix', async () => {
    const found = await findTaskByPrefix(tmpDir, '00000000');
    expect(found).toBeNull();
  });
});
