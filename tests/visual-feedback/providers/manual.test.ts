/**
 * Tests for the manual visual feedback provider (src/visual-feedback/providers/manual.ts).
 */

import { describe, it, expect } from 'vitest';
import { ManualFeedbackProvider } from '../../../src/visual-feedback/providers/manual.js';
import { VisualFeedbackSchema } from '../../../src/visual-feedback/schema.js';
import type { RawAnnotation } from '../../../src/visual-feedback/providers/base.js';
import type { ClientConfig } from '../../../src/core/schemas.js';

const provider = new ManualFeedbackProvider();

// ─── checkAvailability ──────────────────────────────────────────────────────

describe('checkAvailability', () => {
  it('returns available=true', async () => {
    const status = await provider.checkAvailability();
    expect(status.available).toBe(true);
    expect(status.connected).toBe(true);
    expect(status.error).toBeNull();
  });
});

// ─── detectCompatibility ────────────────────────────────────────────────────

describe('detectCompatibility', () => {
  it('returns compatible=true for any platform', async () => {
    const now = new Date().toISOString();
    const config = {
      slug: 'test',
      name: 'Test',
      workspace: '/tmp/test',
      createdAt: now,
      updatedAt: now,
    } as ClientConfig;

    for (const platform of ['wordpress', 'shopify', 'nextjs', 'react', 'unknown'] as const) {
      const result = await provider.detectCompatibility(platform, config);
      expect(result.compatible).toBe(true);
      expect(result.reason).toContain('always available');
    }
  });
});

// ─── normalize ──────────────────────────────────────────────────────────────

describe('normalize', () => {
  it('creates valid VisualFeedback from a raw annotation', () => {
    const raw: RawAnnotation = {
      id: 'ann-001',
      pageUrl: 'https://example.com/test',
      comment: 'Button is broken',
      kind: 'bug',
      severity: 'high',
      selector: '.btn-primary',
      tag: 'button',
    };

    const result = provider.normalize(raw, 'test-client');

    // Should parse as valid VisualFeedback
    expect(() => VisualFeedbackSchema.parse(result)).not.toThrow();

    expect(result.id).toBe('ann-001');
    expect(result.provider).toBe('manual');
    expect(result.clientId).toBe('test-client');
    expect(result.pageUrl).toBe('https://example.com/test');
    expect(result.comment).toBe('Button is broken');
    expect(result.kind).toBe('bug');
    expect(result.severity).toBe('high');
    expect(result.status).toBe('pending');
    expect(result.elementSelector).toBe('.btn-primary');
    expect(result.elementTag).toBe('button');
    expect(result.providerAnnotationId).toBe('ann-001');
  });

  it('handles missing fields gracefully with defaults', () => {
    const raw: RawAnnotation = {
      id: 'ann-002',
    };

    const result = provider.normalize(raw, 'fallback-client');

    // Should still produce valid output
    expect(() => VisualFeedbackSchema.parse(result)).not.toThrow();

    expect(result.id).toBe('ann-002');
    expect(result.provider).toBe('manual');
    expect(result.clientId).toBe('fallback-client');
    expect(result.pageUrl).toBe('https://unknown');
    expect(result.comment).toBe('');
    expect(result.kind).toBe('other');
    expect(result.intent).toBe('investigate');
    expect(result.severity).toBe('medium');
    expect(result.status).toBe('pending');
  });

  it('uses url field as fallback when pageUrl is missing', () => {
    const raw: RawAnnotation = {
      id: 'ann-003',
      url: 'https://example.com/fallback',
      comment: 'Test',
    };

    const result = provider.normalize(raw, 'client');
    expect(result.pageUrl).toBe('https://example.com/fallback');
  });

  it('uses text field as fallback when comment is missing', () => {
    const raw: RawAnnotation = {
      id: 'ann-004',
      text: 'Some text annotation',
      pageUrl: 'https://example.com',
    };

    const result = provider.normalize(raw, 'client');
    expect(result.comment).toBe('Some text annotation');
  });
});

// ─── reportCapabilities ─────────────────────────────────────────────────────

describe('reportCapabilities', () => {
  it('returns correct capability values', () => {
    const caps = provider.reportCapabilities();

    expect(caps.canStartSession).toBe(false);
    expect(caps.canAcknowledge).toBe(false);
    expect(caps.canResolve).toBe(false);
    expect(caps.supportsRealtime).toBe(false);
    expect(caps.requiresToolbarInstall).toBe(false);
    expect(caps.supportedPlatforms).toContain('wordpress');
    expect(caps.supportedPlatforms).toContain('shopify');
    expect(caps.supportedPlatforms).toContain('nextjs');
    expect(caps.supportedPlatforms).toContain('react');
    expect(caps.supportedPlatforms.length).toBeGreaterThan(0);
  });
});
