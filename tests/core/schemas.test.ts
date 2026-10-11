/**
 * Tests for core schemas.
 */

import { describe, it, expect } from 'vitest';
import {
  ClientFactsSchema,
  ClientConfigSchema,
  GlobalConfigSchema,
  FindingSchema,
  ImplementationPlanSchema,
  SkillMetadataSchema,
  AuditRunSchema,
} from '../../src/core/schemas.js';

describe('ClientFactsSchema', () => {
  it('validates a minimal valid client facts object', () => {
    const result = ClientFactsSchema.parse({
      name: 'EkeBoss Restaurant',
      slug: 'ekeboss',
    });
    expect(result.name).toBe('EkeBoss Restaurant');
    expect(result.slug).toBe('ekeboss');
    expect(result.objectives).toEqual([]);
    expect(result.knownUrls).toEqual([]);
  });

  it('rejects invalid slug with spaces', () => {
    expect(() =>
      ClientFactsSchema.parse({ name: 'Test', slug: 'invalid slug' }),
    ).toThrow();
  });

  it('rejects invalid URL in knownUrls', () => {
    expect(() =>
      ClientFactsSchema.parse({ name: 'Test', slug: 'test', knownUrls: ['not-a-url'] }),
    ).toThrow();
  });

  it('accepts valid URLs in knownUrls', () => {
    const result = ClientFactsSchema.parse({
      name: 'Test',
      slug: 'test',
      knownUrls: ['https://example.com', 'https://shop.example.com'],
    });
    expect(result.knownUrls).toHaveLength(2);
  });
});

describe('ClientConfigSchema', () => {
  it('validates a minimal client config', () => {
    const now = new Date().toISOString();
    const result = ClientConfigSchema.parse({
      slug: 'test',
      name: 'Test Client',
      createdAt: now,
      updatedAt: now,
      workspace: '/tmp/test',
    });
    expect(result.slug).toBe('test');
    expect(result.auditSettings.maxPages).toBe(50);
    expect(result.auditSettings.viewports).toHaveLength(2);
  });

  it('has correct default viewports', () => {
    const now = new Date().toISOString();
    const result = ClientConfigSchema.parse({
      slug: 'test',
      name: 'Test',
      createdAt: now,
      updatedAt: now,
      workspace: '/tmp/test',
    });
    const desktopVp = result.auditSettings.viewports.find((v) => v.name === 'desktop');
    expect(desktopVp).toBeDefined();
    expect(desktopVp?.width).toBe(1440);
  });
});

describe('GlobalConfigSchema', () => {
  it('uses sensible defaults', () => {
    const result = GlobalConfigSchema.parse({});
    expect(result.workspaceRoot).toBe('~/Aethra/clients');
    expect(result.defaults.browser).toBe('chromium');
    expect(result.safety.allowProductionMutations).toBe(false);
    expect(result.agents.requirePlanBeforeEdits).toBe(true);
  });
});

describe('FindingSchema', () => {
  it('validates a finding', () => {
    const result = FindingSchema.parse({
      id: 'finding-001',
      category: 'performance',
      severity: 'high',
      title: 'Slow page load',
      status: 'observed',
    });
    expect(result.id).toBe('finding-001');
    expect(result.verificationRequired).toBe(true);
  });

  it('rejects invalid severity', () => {
    expect(() =>
      FindingSchema.parse({
        id: 'x',
        category: 'perf',
        severity: 'extreme', // not valid
        title: 'test',
      }),
    ).toThrow();
  });
});

describe('ImplementationPlanSchema', () => {
  it('validates a draft plan', () => {
    const now = new Date().toISOString();
    const result = ImplementationPlanSchema.parse({
      id: 'plan-001',
      title: 'Improve mobile booking',
      taskDescription: 'Improve the mobile booking journey',
      clientSlug: 'ekeboss',
      createdAt: now,
      updatedAt: now,
    });
    expect(result.status).toBe('draft');
    expect(result.acceptanceCriteria).toEqual([]);
  });
});

describe('SkillMetadataSchema', () => {
  it('validates a skill', () => {
    const now = new Date().toISOString();
    const result = SkillMetadataSchema.parse({
      name: 'website-audit',
      version: '0.1.0',
      description: 'Audit a client website',
      status: 'approved',
      category: 'audit',
      whenToInvoke: 'When a website audit is needed',
      createdAt: now,
      updatedAt: now,
    });
    expect(result.name).toBe('website-audit');
    expect(result.status).toBe('approved');
  });

  it('rejects invalid status', () => {
    const now = new Date().toISOString();
    expect(() =>
      SkillMetadataSchema.parse({
        name: 'test',
        version: '0.1.0',
        description: 'Test',
        status: 'invalid-status',
        category: 'test',
        whenToInvoke: 'test',
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow();
  });
});
