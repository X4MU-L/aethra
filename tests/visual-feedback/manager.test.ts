/**
 * Tests for the visual feedback manager (src/visual-feedback/manager.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {
  saveFeedback,
  loadFeedback,
  listFeedback,
  linkFeedbackToTask,
  resolveFeedback,
  feedbackToFinding,
  createPlanFromFeedback,
} from '../../src/visual-feedback/manager.js';
import { VisualFeedbackSchema } from '../../src/visual-feedback/schema.js';
import type { VisualFeedback } from '../../src/visual-feedback/schema.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'aethra-vf-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Create a valid VisualFeedback object with optional overrides. */
function makeFeedback(overrides: Partial<VisualFeedback> = {}): VisualFeedback {
  return VisualFeedbackSchema.parse({
    id: crypto.randomBytes(8).toString('hex'),
    provider: 'manual',
    clientId: 'test-client',
    pageUrl: 'https://example.com',
    comment: 'Test feedback',
    createdAt: new Date().toISOString(),
    ...overrides,
  });
}

// ─── saveFeedback / loadFeedback ────────────────────────────────────────────

describe('saveFeedback and loadFeedback', () => {
  it('round-trips a feedback item through save and load', async () => {
    const feedback = makeFeedback({ comment: 'Round-trip test' });
    await saveFeedback(tmpDir, feedback);

    const loaded = await loadFeedback(tmpDir, feedback.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(feedback.id);
    expect(loaded!.comment).toBe('Round-trip test');
    expect(loaded!.status).toBe('pending');
  });

  it('returns null for a non-existent feedback ID', async () => {
    const loaded = await loadFeedback(tmpDir, 'does-not-exist');
    expect(loaded).toBeNull();
  });
});

// ─── listFeedback ───────────────────────────────────────────────────────────

describe('listFeedback', () => {
  it('returns saved items', async () => {
    const fb1 = makeFeedback({ comment: 'First' });
    const fb2 = makeFeedback({ comment: 'Second' });
    await saveFeedback(tmpDir, fb1);
    await saveFeedback(tmpDir, fb2);

    const items = await listFeedback(tmpDir);
    expect(items).toHaveLength(2);
    const ids = items.map((i) => i.id);
    expect(ids).toContain(fb1.id);
    expect(ids).toContain(fb2.id);
  });

  it('filters by status', async () => {
    const pending = makeFeedback({ comment: 'Pending one' });
    const triaged = makeFeedback({ comment: 'Triaged one', status: 'triaged' });
    await saveFeedback(tmpDir, pending);
    await saveFeedback(tmpDir, triaged);

    const filtered = await listFeedback(tmpDir, { status: 'triaged' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.id).toBe(triaged.id);
  });

  it('filters by pageUrl', async () => {
    const fb1 = makeFeedback({ pageUrl: 'https://example.com/page-a' });
    const fb2 = makeFeedback({ pageUrl: 'https://example.com/page-b' });
    await saveFeedback(tmpDir, fb1);
    await saveFeedback(tmpDir, fb2);

    const filtered = await listFeedback(tmpDir, { pageUrl: 'https://example.com/page-a' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.id).toBe(fb1.id);
  });

  it('returns empty array when no feedback directory exists', async () => {
    const emptyDir = mkdtempSync(path.join(os.tmpdir(), 'aethra-vf-empty-'));
    try {
      const items = await listFeedback(emptyDir);
      expect(items).toEqual([]);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

// ─── linkFeedbackToTask ─────────────────────────────────────────────────────

describe('linkFeedbackToTask', () => {
  it('updates status to linked and sets taskId', async () => {
    const feedback = makeFeedback();
    await saveFeedback(tmpDir, feedback);

    const updated = await linkFeedbackToTask(tmpDir, feedback.id, 'task-123');
    expect(updated.status).toBe('linked');
    expect(updated.taskId).toBe('task-123');

    // Verify persistence
    const reloaded = await loadFeedback(tmpDir, feedback.id);
    expect(reloaded!.status).toBe('linked');
    expect(reloaded!.taskId).toBe('task-123');
  });

  it('throws when feedback does not exist', async () => {
    await expect(
      linkFeedbackToTask(tmpDir, 'nonexistent', 'task-1'),
    ).rejects.toThrow('Feedback not found');
  });
});

// ─── resolveFeedback ────────────────────────────────────────────────────────

describe('resolveFeedback', () => {
  it('sets status to resolved and records summary', async () => {
    const feedback = makeFeedback();
    await saveFeedback(tmpDir, feedback);

    const resolved = await resolveFeedback(tmpDir, feedback.id, 'Fixed the button alignment');
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolutionSummary).toBe('Fixed the button alignment');

    // Verify persistence
    const reloaded = await loadFeedback(tmpDir, feedback.id);
    expect(reloaded!.status).toBe('resolved');
    expect(reloaded!.resolutionSummary).toBe('Fixed the button alignment');
  });

  it('throws when feedback does not exist', async () => {
    await expect(
      resolveFeedback(tmpDir, 'nonexistent', 'summary'),
    ).rejects.toThrow('Feedback not found');
  });
});

// ─── feedbackToFinding ──────────────────────────────────────────────────────

describe('feedbackToFinding', () => {
  it('converts feedback to a Finding correctly', () => {
    const feedback = makeFeedback({
      comment: 'Navigation menu overlaps content on mobile',
      kind: 'bug',
      severity: 'high',
      pageUrl: 'https://example.com/home',
      screenshotReference: '/screenshots/nav-bug.png',
      viewport: { width: 375, height: 812 },
    });

    const finding = feedbackToFinding(feedback);

    expect(finding.id).toBe(`fb-${feedback.id}`);
    expect(finding.category).toBe('visual');
    expect(finding.severity).toBe('high');
    expect(finding.title).toBe('Navigation menu overlaps content on mobile');
    expect(finding.description).toBe('Navigation menu overlaps content on mobile');
    expect(finding.status).toBe('observed');
    expect(finding.verificationRequired).toBe(true);
    expect(finding.confidence).toBe(1.0);
    expect(finding.url).toBe('https://example.com/home');
    expect(finding.viewport).toBe('375x812');
    expect(finding.evidence).toHaveLength(1);
    expect(finding.evidence[0]!.path).toBe('/screenshots/nav-bug.png');
  });

  it('sets category to accessibility for a11y feedback', () => {
    const feedback = makeFeedback({ kind: 'accessibility' });
    const finding = feedbackToFinding(feedback);
    expect(finding.category).toBe('accessibility');
  });

  it('sets finding status to resolved when feedback is resolved', () => {
    const feedback = makeFeedback({ status: 'resolved' });
    const finding = feedbackToFinding(feedback);
    expect(finding.status).toBe('resolved');
  });

  it('returns empty evidence when no screenshot reference', () => {
    const feedback = makeFeedback();
    const finding = feedbackToFinding(feedback);
    expect(finding.evidence).toEqual([]);
  });
});

// ─── createPlanFromFeedback ─────────────────────────────────────────────────

describe('createPlanFromFeedback', () => {
  it('creates plan JSON and a task record', async () => {
    const fb1 = makeFeedback({ comment: 'Fix header alignment' });
    const fb2 = makeFeedback({ comment: 'Update footer color', pageUrl: 'https://example.com/about' });
    await saveFeedback(tmpDir, fb1);
    await saveFeedback(tmpDir, fb2);

    const { plan, taskRecord } = await createPlanFromFeedback(tmpDir, [fb1, fb2], 'test-client');

    // Plan assertions
    expect(plan.id).toBeTruthy();
    expect(plan.clientSlug).toBe('test-client');
    expect(plan.status).toBe('draft');
    expect(plan.feedbackIds).toContain(fb1.id);
    expect(plan.feedbackIds).toContain(fb2.id);
    expect(plan.affectedRoutes).toHaveLength(2);

    // Task record assertions
    expect(taskRecord.id).toBeTruthy();
    expect(taskRecord.clientSlug).toBe('test-client');
    expect(taskRecord.status).toBe('planned');

    // Feedback items should be linked
    const reloaded1 = await loadFeedback(tmpDir, fb1.id);
    expect(reloaded1!.status).toBe('linked');
    expect(reloaded1!.taskId).toBe(taskRecord.id);
  });

  it('throws on empty feedback array', async () => {
    await expect(
      createPlanFromFeedback(tmpDir, [], 'test-client'),
    ).rejects.toThrow('No feedback items provided');
  });

  it('creates a descriptive title for a single feedback item', async () => {
    const fb = makeFeedback({ comment: 'Fix the hero image sizing' });
    await saveFeedback(tmpDir, fb);

    const { plan } = await createPlanFromFeedback(tmpDir, [fb], 'test-client');
    expect(plan.title).toContain('Fix');
    expect(plan.title).toContain('hero image');
  });
});
