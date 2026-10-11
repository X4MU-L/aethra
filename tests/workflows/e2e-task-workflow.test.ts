/**
 * End-to-end test: full plan-fix → approve → apply-fix → verify workflow.
 *
 * Uses the nextjs-defect fixture:
 *   tests/fixtures/nextjs-defect/src/cart.ts         — BUGGY implementation
 *   tests/fixtures/nextjs-defect/src/cart.fixed.ts   — FIXED implementation
 *   tests/fixtures/nextjs-defect/src/cart.test.ts    — tests that FAIL against buggy code
 *   tests/fixtures/nextjs-defect/src/cart.fixed.test.ts — same tests against fixed code (PASS)
 *
 * Proves:
 *   1. The testrunner detects test failures on the buggy implementation.
 *   2. The testrunner detects test success on the fixed implementation.
 *   3. The task lifecycle correctly transitions through all states.
 *   4. verify --run-tests failure moves the task back to in-progress.
 *   5. verify --run-tests success marks the task completed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

import {
  createTask,
  transitionTask,
  loadTask,
} from '../../src/engine/tasks.js';
import { runTestSuite } from '../../src/engine/testrunner.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

// Fixture test files (inside the repo — vitest can find them via positional pattern)
const BUGGY_TEST   = 'tests/fixtures/nextjs-defect/src/cart.test.ts';
const FIXED_TEST   = 'tests/fixtures/nextjs-defect/src/cart.fixed.test.ts';

// ─── Shared state ─────────────────────────────────────────────────────────────

let tmpWorkspace: string;

beforeAll(async () => {
  tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aethra-e2e-'));
  await fs.mkdir(path.join(tmpWorkspace, 'tasks'), { recursive: true });
  await fs.mkdir(path.join(tmpWorkspace, 'plans'), { recursive: true });
  await fs.mkdir(path.join(tmpWorkspace, '.local'), { recursive: true });
});

afterAll(async () => {
  const { closeDb } = await import('../../src/engine/db.js');
  closeDb(tmpWorkspace);
  await fs.rm(tmpWorkspace, { recursive: true, force: true });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function writePlan(workspacePath: string, title: string) {
  const planId = crypto.randomBytes(4).toString('hex');
  const planPath = path.join(workspacePath, 'plans', `${planId}.json`);
  await fs.writeFile(
    planPath,
    JSON.stringify({
      id: planId,
      title,
      status: 'approved',
      task: title,
      targetUrl: 'https://example.com',
      platform: 'nextjs',
      findings: [],
      proposedChanges: [
        {
          file: 'src/cart.ts',
          change: 'Fix applyDiscount: return price * (1 - rate) instead of price * rate',
          rationale: 'Bug: function returns discount amount, not discounted price',
        },
      ],
      acceptanceCriteria: [
        {
          id: 'ac-1',
          description: 'applyDiscount(100, 0.2) returns 80, not 20',
          category: 'functional',
          verificationMethod: 'automated-test',
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    'utf-8',
  );
  return { planId, planPath };
}

// ─── Testrunner unit tests ────────────────────────────────────────────────────

describe('testrunner — fixture', () => {
  it('reports FAILURE on the buggy cart.ts', async () => {
    const result = await runTestSuite(REPO_ROOT, {
      cwd: REPO_ROOT,
      include: [BUGGY_TEST],
      timeoutMs: 30_000,
    });

    // cart.test.ts fails against the buggy implementation (price * rate ≠ discounted price)
    expect(result.passed).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.failedCount).toBeGreaterThan(0);
  }, 40_000);

  it('reports SUCCESS on the fixed implementation', async () => {
    const result = await runTestSuite(REPO_ROOT, {
      cwd: REPO_ROOT,
      include: [FIXED_TEST],
      timeoutMs: 30_000,
    });

    // cart.fixed.test.ts imports cart.fixed.ts — all tests pass
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(result.passedCount).toBeGreaterThan(0);
  }, 40_000);
});

// ─── Full lifecycle test ──────────────────────────────────────────────────────

describe('task lifecycle — full workflow', () => {
  let taskId: string;

  it('step 1: create plan + task (planned)', async () => {
    const { planId, planPath } = await writePlan(tmpWorkspace, 'Fix cart discount bug');
    const task = await createTask(
      tmpWorkspace,
      planId,
      planPath,
      'Fix cart discount bug',
      'nextjs-defect',
    );
    taskId = task.id;

    expect(task.status).toBe('planned');
    expect(task.planPath).toBe(planPath);
  });

  it('step 2: approve task (planned → approved)', async () => {
    const task = await transitionTask(tmpWorkspace, taskId, 'approved', {
      approvedBy: 'Ebuka Okoli',
      approvedAt: new Date().toISOString(),
    });

    expect(task.status).toBe('approved');
    expect(task.approvedBy).toBe('Ebuka Okoli');
  });

  it('step 3: start implementation (approved → in-progress)', async () => {
    const task = await transitionTask(tmpWorkspace, taskId, 'in-progress', {
      gitBranch: 'fix/cart-discount-bug',
    });

    expect(task.status).toBe('in-progress');
    expect(task.gitBranch).toBe('fix/cart-discount-bug');
  });

  it('step 4: verify fails on buggy code — task returns to in-progress', async () => {
    await transitionTask(tmpWorkspace, taskId, 'verifying');

    // Run tests against the buggy implementation
    const testRun = await runTestSuite(REPO_ROOT, {
      cwd: REPO_ROOT,
      include: [BUGGY_TEST],
      timeoutMs: 30_000,
    });

    // Tests must fail on the buggy code
    expect(testRun.passed).toBe(false);
    expect(testRun.failedCount).toBeGreaterThan(0);

    // Failing tests drive the task back to in-progress
    const task = await transitionTask(tmpWorkspace, taskId, 'in-progress', {
      notes: `Tests failed: ${testRun.failedCount} failing (${testRun.passedCount} passing)`,
    });
    expect(task.status).toBe('in-progress');
    expect(task.notes).toContain('Tests failed');
  }, 40_000);

  it('step 5: apply fix and verify passes — task completes', async () => {
    await transitionTask(tmpWorkspace, taskId, 'verifying');

    // Run tests against the FIXED implementation
    const testRun = await runTestSuite(REPO_ROOT, {
      cwd: REPO_ROOT,
      include: [FIXED_TEST],
      timeoutMs: 30_000,
    });

    // Tests must pass on the fixed code
    expect(testRun.passed).toBe(true);
    expect(testRun.failedCount).toBe(0);
    expect(testRun.passedCount).toBeGreaterThan(0);

    // Passing tests complete the task
    const task = await transitionTask(tmpWorkspace, taskId, 'completed', {
      verificationId: crypto.randomBytes(4).toString('hex'),
    });
    expect(task.status).toBe('completed');
    expect(task.completedAt).toBeDefined();
  }, 40_000);

  it('step 6: completed task cannot be transitioned further', async () => {
    const loaded = await loadTask(tmpWorkspace, taskId);
    expect(loaded?.status).toBe('completed');

    // transitionTask should throw: completed → in-progress is not a valid transition
    await expect(transitionTask(tmpWorkspace, taskId, 'in-progress')).rejects.toThrow();
  });
});
