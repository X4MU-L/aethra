/**
 * Tests for the SQLite database module (src/engine/db.ts).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  getTestDb,
  dbCreateTask,
  dbLoadTask,
  dbSaveTask,
  dbListTasks,
  dbFindTaskByPrefix,
  dbSaveFeedback,
  dbLoadFeedback,
  dbListFeedback,
  dbCreateSession,
  dbLoadSession,
  dbSaveAuditRun,
  dbLoadLatestAudit,
  dbSaveFindings,
  dbQueryFindings,
  dbSavePlanMeta,
  dbListPlans,
} from '../../src/engine/db.js';
import type { TaskRecord, Finding, ImplementationPlan, AuditRun } from '../../src/core/schemas.js';
import type { VisualFeedback, FeedbackSession } from '../../src/visual-feedback/schema.js';
import type Database from 'better-sqlite3';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: crypto.randomBytes(8).toString('hex'),
    title: 'Test task',
    clientSlug: 'test-client',
    status: 'planned',
    planId: 'plan-123',
    planPath: '/tmp/plan.json',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    feedbackIds: [],
    ...overrides,
  } as TaskRecord;
}

function makeFeedback(overrides: Partial<VisualFeedback> = {}): VisualFeedback {
  return {
    id: crypto.randomBytes(8).toString('hex'),
    provider: 'manual',
    clientId: 'client-1',
    pageUrl: 'https://example.com/page',
    comment: 'Something looks off',
    kind: 'bug',
    intent: 'fix',
    severity: 'medium',
    createdAt: new Date().toISOString(),
    status: 'pending',
    relatedFindingIds: [],
    relatedFeedbackIds: [],
    ...overrides,
  } as VisualFeedback;
}

function makeSession(overrides: Partial<FeedbackSession> = {}): FeedbackSession {
  return {
    id: crypto.randomBytes(8).toString('hex'),
    clientSlug: 'test-client',
    provider: 'manual',
    startedAt: new Date().toISOString(),
    pageUrls: ['https://example.com'],
    feedbackIds: [],
    status: 'active',
    ...overrides,
  } as FeedbackSession;
}

function makeAuditRun(overrides: Partial<AuditRun> = {}): AuditRun {
  return {
    id: crypto.randomBytes(8).toString('hex'),
    clientSlug: 'test-client',
    type: 'baseline',
    startedAt: new Date().toISOString(),
    status: 'completed',
    pagesInspected: ['https://example.com'],
    findings: [],
    artifactManifest: [],
    errors: [],
    limitations: [],
    environment: { os: 'darwin', nodeVersion: '20.0.0' },
    ...overrides,
  } as AuditRun;
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: crypto.randomBytes(8).toString('hex'),
    category: 'performance',
    severity: 'high',
    title: 'Slow page load',
    description: 'Page takes > 5s to load',
    status: 'observed',
    evidence: [],
    verificationRequired: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Finding;
}

function makePlan(overrides: Partial<ImplementationPlan> = {}): ImplementationPlan {
  return {
    id: crypto.randomBytes(8).toString('hex'),
    title: 'Fix slow page load',
    taskDescription: 'Optimize images and reduce JS bundle',
    clientSlug: 'test-client',
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    evidenceBasis: [],
    affectedFiles: [],
    affectedRoutes: [],
    proposedChanges: [],
    acceptanceCriteria: [],
    risks: [],
    dependencies: [],
    openQuestions: [],
    feedbackIds: [],
    ...overrides,
  } as ImplementationPlan;
}

// ─── Tasks ──────────────────────────────────────────────────────────────────

describe('Tasks', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = getTestDb();
  });

  it('creates and loads a task by ID', () => {
    const task = makeTask();
    dbCreateTask(db, task);
    const loaded = dbLoadTask(db, task.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(task.id);
    expect(loaded!.title).toBe(task.title);
    expect(loaded!.status).toBe('planned');
  });

  it('lists tasks sorted by createdAt DESC', () => {
    const t1 = makeTask({ createdAt: '2025-01-01T00:00:00.000Z' });
    const t2 = makeTask({ createdAt: '2025-06-01T00:00:00.000Z' });
    const t3 = makeTask({ createdAt: '2025-03-01T00:00:00.000Z' });
    dbCreateTask(db, t1);
    dbCreateTask(db, t2);
    dbCreateTask(db, t3);

    const tasks = dbListTasks(db);
    expect(tasks).toHaveLength(3);
    expect(tasks[0]!.id).toBe(t2.id);
    expect(tasks[1]!.id).toBe(t3.id);
    expect(tasks[2]!.id).toBe(t1.id);
  });

  it('lists tasks with status filter', () => {
    const planned = makeTask({ status: 'planned' });
    const approved = makeTask({ status: 'approved' });
    dbCreateTask(db, planned);
    dbCreateTask(db, approved);

    const result = dbListTasks(db, { status: 'approved' });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(approved.id);
  });

  it('saves (updates) a task and reloads', () => {
    const task = makeTask();
    dbCreateTask(db, task);

    task.status = 'approved';
    task.notes = 'LGTM';
    task.updatedAt = new Date().toISOString();
    dbSaveTask(db, task);

    const reloaded = dbLoadTask(db, task.id);
    expect(reloaded!.status).toBe('approved');
    expect(reloaded!.notes).toBe('LGTM');
  });

  it('finds task by full ID', () => {
    const task = makeTask();
    dbCreateTask(db, task);
    const found = dbFindTaskByPrefix(db, task.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(task.id);
  });

  it('finds task by 8-char prefix', () => {
    const task = makeTask();
    dbCreateTask(db, task);
    const found = dbFindTaskByPrefix(db, task.id.slice(0, 8));
    expect(found).not.toBeNull();
    expect(found!.id).toBe(task.id);
  });

  it('returns null for unknown prefix', () => {
    const found = dbFindTaskByPrefix(db, 'zzzzzzzz');
    expect(found).toBeNull();
  });

  it('returns null for unknown ID', () => {
    const loaded = dbLoadTask(db, 'nonexistent-id');
    expect(loaded).toBeNull();
  });
});

// ─── Feedback ───────────────────────────────────────────────────────────────

describe('Feedback', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = getTestDb();
  });

  it('saves and loads feedback by ID', () => {
    const fb = makeFeedback();
    dbSaveFeedback(db, fb);
    const loaded = dbLoadFeedback(db, fb.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(fb.id);
    expect(loaded!.comment).toBe(fb.comment);
  });

  it('lists feedback sorted by createdAt DESC', () => {
    const fb1 = makeFeedback({ createdAt: '2025-01-01T00:00:00.000Z' });
    const fb2 = makeFeedback({ createdAt: '2025-06-01T00:00:00.000Z' });
    dbSaveFeedback(db, fb1);
    dbSaveFeedback(db, fb2);

    const list = dbListFeedback(db);
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe(fb2.id);
    expect(list[1]!.id).toBe(fb1.id);
  });

  it('filters feedback by status', () => {
    const pending = makeFeedback({ status: 'pending' });
    const resolved = makeFeedback({ status: 'resolved' });
    dbSaveFeedback(db, pending);
    dbSaveFeedback(db, resolved);

    const result = dbListFeedback(db, { status: 'resolved' });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(resolved.id);
  });

  it('filters feedback by pageUrl', () => {
    const fb1 = makeFeedback({ pageUrl: 'https://example.com/a' });
    const fb2 = makeFeedback({ pageUrl: 'https://example.com/b' });
    dbSaveFeedback(db, fb1);
    dbSaveFeedback(db, fb2);

    const result = dbListFeedback(db, { pageUrl: 'https://example.com/a' });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(fb1.id);
  });

  it('filters feedback by taskId', () => {
    const fb1 = makeFeedback({ taskId: 'task-aaa' });
    const fb2 = makeFeedback({ taskId: 'task-bbb' });
    dbSaveFeedback(db, fb1);
    dbSaveFeedback(db, fb2);

    const result = dbListFeedback(db, { taskId: 'task-aaa' });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(fb1.id);
  });

  it('applies multiple filters together (status + pageUrl)', () => {
    const fb1 = makeFeedback({ status: 'pending', pageUrl: 'https://example.com/x' });
    const fb2 = makeFeedback({ status: 'resolved', pageUrl: 'https://example.com/x' });
    const fb3 = makeFeedback({ status: 'pending', pageUrl: 'https://example.com/y' });
    dbSaveFeedback(db, fb1);
    dbSaveFeedback(db, fb2);
    dbSaveFeedback(db, fb3);

    const result = dbListFeedback(db, { status: 'pending', pageUrl: 'https://example.com/x' });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(fb1.id);
  });

  it('returns null for unknown feedback ID', () => {
    const loaded = dbLoadFeedback(db, 'nonexistent');
    expect(loaded).toBeNull();
  });

  it('JSON fields round-trip correctly (boundingBox, componentTree, cssClasses)', () => {
    const fb = makeFeedback({
      boundingBox: { x: 10, y: 20, width: 100, height: 50 },
      componentTree: ['App', 'Layout', 'Header'],
      cssClasses: ['nav-bar', 'sticky'],
    });
    dbSaveFeedback(db, fb);

    const loaded = dbLoadFeedback(db, fb.id);
    expect(loaded!.boundingBox).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    expect(loaded!.componentTree).toEqual(['App', 'Layout', 'Header']);
    expect(loaded!.cssClasses).toEqual(['nav-bar', 'sticky']);
  });
});

// ─── Sessions ───────────────────────────────────────────────────────────────

describe('Sessions', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = getTestDb();
  });

  it('creates and loads a session', () => {
    const session = makeSession();
    dbCreateSession(db, session);
    const loaded = dbLoadSession(db, session.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(session.id);
    expect(loaded!.clientSlug).toBe(session.clientSlug);
    expect(loaded!.provider).toBe(session.provider);
    expect(loaded!.pageUrls).toEqual(session.pageUrls);
  });
});

// ─── Audit runs + findings ──────────────────────────────────────────────────

describe('Audit runs + findings', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = getTestDb();
  });

  it('saves audit run and loads latest by type', () => {
    const older = makeAuditRun({
      type: 'baseline',
      startedAt: '2025-01-01T00:00:00.000Z',
    });
    const newer = makeAuditRun({
      type: 'baseline',
      startedAt: '2025-06-01T00:00:00.000Z',
    });
    dbSaveAuditRun(db, older);
    dbSaveAuditRun(db, newer);

    const latest = dbLoadLatestAudit(db, 'baseline');
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe(newer.id);
  });

  it('returns null when no audits exist', () => {
    const latest = dbLoadLatestAudit(db, 'baseline');
    expect(latest).toBeNull();
  });

  it('saves findings and queries by severity', () => {
    const audit = makeAuditRun();
    dbSaveAuditRun(db, audit);

    const f1 = makeFinding({ severity: 'high' });
    const f2 = makeFinding({ severity: 'low' });
    const f3 = makeFinding({ severity: 'high' });
    dbSaveFindings(db, audit.id, [f1, f2, f3]);

    const highFindings = dbQueryFindings(db, { severity: 'high' });
    expect(highFindings).toHaveLength(2);
    expect(highFindings.every((f) => f.severity === 'high')).toBe(true);
  });

  it('queries findings by category', () => {
    const audit = makeAuditRun();
    dbSaveAuditRun(db, audit);

    const f1 = makeFinding({ category: 'performance' });
    const f2 = makeFinding({ category: 'accessibility' });
    dbSaveFindings(db, audit.id, [f1, f2]);

    const result = dbQueryFindings(db, { category: 'accessibility' });
    expect(result).toHaveLength(1);
    expect(result[0]!.category).toBe('accessibility');
  });

  it('queries findings by auditRunId', () => {
    const audit1 = makeAuditRun();
    const audit2 = makeAuditRun();
    dbSaveAuditRun(db, audit1);
    dbSaveAuditRun(db, audit2);

    const f1 = makeFinding();
    const f2 = makeFinding();
    dbSaveFindings(db, audit1.id, [f1]);
    dbSaveFindings(db, audit2.id, [f2]);

    const result = dbQueryFindings(db, { auditRunId: audit1.id });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(f1.id);
  });
});

// ─── Plans ──────────────────────────────────────────────────────────────────

describe('Plans', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = getTestDb();
  });

  it('saves plan metadata and lists plans', () => {
    const plan = makePlan();
    dbSavePlanMeta(db, plan, '/tmp/plan.json');

    const plans = dbListPlans(db);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.id).toBe(plan.id);
    expect(plans[0]!.title).toBe(plan.title);
    expect(plans[0]!.filePath).toBe('/tmp/plan.json');
  });

  it('lists plans with status filter', () => {
    const draft = makePlan({ status: 'draft' });
    const approved = makePlan({ status: 'approved' });
    dbSavePlanMeta(db, draft, '/tmp/draft.json');
    dbSavePlanMeta(db, approved, '/tmp/approved.json');

    const result = dbListPlans(db, { status: 'approved' });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(approved.id);
  });
});
