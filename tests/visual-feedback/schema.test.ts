/**
 * Tests for visual feedback Zod schemas (src/visual-feedback/schema.ts).
 */

import { describe, it, expect } from 'vitest';
import {
  VisualFeedbackSchema,
  BoundingBoxSchema,
  FeedbackSessionSchema,
  VisualFeedbackStatusSchema,
} from '../../src/visual-feedback/schema.js';

// Helper: minimal valid feedback input (before defaults are applied)
function validFeedbackInput() {
  return {
    id: 'fb-001',
    provider: 'manual',
    clientId: 'test-client',
    pageUrl: 'https://example.com/page',
    comment: 'Button is misaligned',
    createdAt: new Date().toISOString(),
  };
}

// ─── VisualFeedbackSchema ────────────────────────────────────────────────────

describe('VisualFeedbackSchema', () => {
  it('parses valid feedback with all required fields', () => {
    const input = validFeedbackInput();
    const result = VisualFeedbackSchema.parse(input);

    expect(result.id).toBe('fb-001');
    expect(result.provider).toBe('manual');
    expect(result.clientId).toBe('test-client');
    expect(result.pageUrl).toBe('https://example.com/page');
    expect(result.comment).toBe('Button is misaligned');
  });

  it('applies defaults for kind, intent, severity, and status', () => {
    const input = validFeedbackInput();
    const result = VisualFeedbackSchema.parse(input);

    expect(result.kind).toBe('other');
    expect(result.intent).toBe('investigate');
    expect(result.severity).toBe('medium');
    expect(result.status).toBe('pending');
  });

  it('applies defaults for relatedFindingIds and relatedFeedbackIds', () => {
    const input = validFeedbackInput();
    const result = VisualFeedbackSchema.parse(input);

    expect(result.relatedFindingIds).toEqual([]);
    expect(result.relatedFeedbackIds).toEqual([]);
  });

  it('rejects missing id', () => {
    const { id: _id, ...rest } = validFeedbackInput();
    expect(() => VisualFeedbackSchema.parse(rest)).toThrow();
  });

  it('rejects missing pageUrl', () => {
    const { pageUrl: _pageUrl, ...rest } = validFeedbackInput();
    expect(() => VisualFeedbackSchema.parse(rest)).toThrow();
  });

  it('rejects missing comment', () => {
    const { comment: _comment, ...rest } = validFeedbackInput();
    expect(() => VisualFeedbackSchema.parse(rest)).toThrow();
  });

  it('rejects missing clientId', () => {
    const { clientId: _clientId, ...rest } = validFeedbackInput();
    expect(() => VisualFeedbackSchema.parse(rest)).toThrow();
  });

  it('rejects missing createdAt', () => {
    const { createdAt: _createdAt, ...rest } = validFeedbackInput();
    expect(() => VisualFeedbackSchema.parse(rest)).toThrow();
  });

  it('rejects invalid pageUrl (not a URL)', () => {
    const input = { ...validFeedbackInput(), pageUrl: 'not-a-url' };
    expect(() => VisualFeedbackSchema.parse(input)).toThrow();
  });

  it('accepts explicit enum values for kind, intent, severity, status', () => {
    const input = {
      ...validFeedbackInput(),
      kind: 'bug',
      intent: 'fix',
      severity: 'critical',
      status: 'triaged',
    };
    const result = VisualFeedbackSchema.parse(input);

    expect(result.kind).toBe('bug');
    expect(result.intent).toBe('fix');
    expect(result.severity).toBe('critical');
    expect(result.status).toBe('triaged');
  });

  it('accepts optional fields when provided', () => {
    const input = {
      ...validFeedbackInput(),
      projectId: 'proj-1',
      taskId: 'task-1',
      sessionId: 'sess-1',
      elementTag: 'button',
      elementSelector: '.btn-primary',
      boundingBox: { x: 10, y: 20, width: 100, height: 50 },
      screenshotReference: '/screenshots/fb-001.png',
      viewport: { width: 1440, height: 900 },
    };
    const result = VisualFeedbackSchema.parse(input);

    expect(result.projectId).toBe('proj-1');
    expect(result.taskId).toBe('task-1');
    expect(result.elementTag).toBe('button');
    expect(result.elementSelector).toBe('.btn-primary');
    expect(result.boundingBox).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    expect(result.screenshotReference).toBe('/screenshots/fb-001.png');
    expect(result.viewport).toEqual({ width: 1440, height: 900 });
  });
});

// ─── BoundingBoxSchema ──────────────────────────────────────────────────────

describe('BoundingBoxSchema', () => {
  it('validates a correct bounding box', () => {
    const result = BoundingBoxSchema.parse({ x: 0, y: 0, width: 200, height: 100 });
    expect(result).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it('rejects missing x', () => {
    expect(() => BoundingBoxSchema.parse({ y: 0, width: 200, height: 100 })).toThrow();
  });

  it('rejects missing y', () => {
    expect(() => BoundingBoxSchema.parse({ x: 0, width: 200, height: 100 })).toThrow();
  });

  it('rejects missing width', () => {
    expect(() => BoundingBoxSchema.parse({ x: 0, y: 0, height: 100 })).toThrow();
  });

  it('rejects missing height', () => {
    expect(() => BoundingBoxSchema.parse({ x: 0, y: 0, width: 200 })).toThrow();
  });

  it('rejects non-numeric values', () => {
    expect(() => BoundingBoxSchema.parse({ x: 'a', y: 0, width: 200, height: 100 })).toThrow();
  });
});

// ─── FeedbackSessionSchema ──────────────────────────────────────────────────

describe('FeedbackSessionSchema', () => {
  it('parses a valid session', () => {
    const input = {
      id: 'sess-001',
      clientSlug: 'acme',
      provider: 'manual',
      startedAt: new Date().toISOString(),
    };
    const result = FeedbackSessionSchema.parse(input);

    expect(result.id).toBe('sess-001');
    expect(result.clientSlug).toBe('acme');
    expect(result.provider).toBe('manual');
    expect(result.status).toBe('active');
    expect(result.pageUrls).toEqual([]);
    expect(result.feedbackIds).toEqual([]);
  });

  it('accepts all valid session statuses', () => {
    const base = {
      id: 'sess-002',
      clientSlug: 'acme',
      provider: 'manual',
      startedAt: new Date().toISOString(),
    };

    for (const status of ['active', 'completed', 'abandoned'] as const) {
      const result = FeedbackSessionSchema.parse({ ...base, status });
      expect(result.status).toBe(status);
    }
  });
});

// ─── VisualFeedbackStatusSchema ─────────────────────────────────────────────

describe('VisualFeedbackStatusSchema', () => {
  const validStatuses = ['pending', 'triaged', 'linked', 'in-progress', 'resolved', 'dismissed'];

  it.each(validStatuses)('accepts "%s" as a valid status', (status) => {
    expect(VisualFeedbackStatusSchema.parse(status)).toBe(status);
  });

  it('rejects an invalid status', () => {
    expect(() => VisualFeedbackStatusSchema.parse('unknown-status')).toThrow();
  });
});
