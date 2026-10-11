/**
 * Tests for report generation logic.
 */

import { describe, it, expect } from 'vitest';
import { generateMarkdownReport, generateJsonReport } from '../../src/reporting/generator.js';
import type { AuditRun } from '../../src/core/schemas.js';

// Minimal valid AuditRun for testing
function makeAudit(overrides: Partial<AuditRun> = {}): AuditRun {
  return {
    id: 'audit-abc123',
    clientSlug: 'test-client',
    type: 'baseline',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:01:00.000Z',
    status: 'completed',
    targetUrl: 'https://example.com',
    pagesInspected: ['https://example.com'],
    findings: [],
    artifactManifest: [],
    errors: [],
    limitations: [],
    environment: {
      os: 'darwin',
      nodeVersion: 'v22.0.0',
    },
    ...overrides,
  };
}

describe('generateMarkdownReport', () => {
  it('produces a Markdown string with client name in heading', () => {
    const result = generateMarkdownReport({
      clientName: 'Acme Corp',
      clientSlug: 'acme-corp',
      audit: null,
      type: 'internal',
    });

    expect(result).toContain('Acme Corp');
    expect(result).toContain('# Engineering Report');
    expect(result).toMatch(/## Executive summary/);
    expect(result).toContain('No audit data available');
  });

  it('uses "Technical Review" heading for client-facing reports', () => {
    const result = generateMarkdownReport({
      clientName: 'Acme Corp',
      clientSlug: 'acme-corp',
      audit: null,
      type: 'client-facing',
    });

    expect(result).toContain('# Technical Review');
    expect(result).not.toContain('Engineering Report');
  });

  it('includes finding counts in summary when audit has findings', () => {
    const audit = makeAudit({
      findings: [
        {
          id: 'f1',
          title: 'Critical issue',
          category: 'performance',
          severity: 'critical',
          verificationRequired: true,
          status: 'observed',
          source: 'lighthouse',
          detectedAt: '2026-01-01T00:01:00.000Z',
        },
        {
          id: 'f2',
          title: 'Medium issue',
          category: 'seo',
          severity: 'medium',
          verificationRequired: false,
          status: 'observed',
          source: 'inspection',
          detectedAt: '2026-01-01T00:01:00.000Z',
        },
      ],
    });

    const result = generateMarkdownReport({
      clientName: 'Acme Corp',
      clientSlug: 'acme-corp',
      audit,
      type: 'internal',
    });

    expect(result).toContain('2 findings');
    expect(result).toContain('1 require priority attention');
    expect(result).toContain('Critical issue');
    expect(result).toContain('Medium issue');
  });

  it('excludes low/info findings from client-facing reports', () => {
    const audit = makeAudit({
      findings: [
        {
          id: 'f1',
          title: 'Low severity note',
          category: 'performance',
          severity: 'low',
          verificationRequired: false,
          status: 'observed',
          source: 'inspection',
          detectedAt: '2026-01-01T00:01:00.000Z',
        },
        {
          id: 'f2',
          title: 'Informational note',
          category: 'seo',
          severity: 'info',
          verificationRequired: false,
          status: 'observed',
          source: 'inspection',
          detectedAt: '2026-01-01T00:01:00.000Z',
        },
      ],
    });

    const clientResult = generateMarkdownReport({
      clientName: 'Acme Corp',
      clientSlug: 'acme-corp',
      audit,
      type: 'client-facing',
    });

    // Low/info section should not appear in client-facing
    expect(clientResult).not.toContain('Low / Informational');

    const internalResult = generateMarkdownReport({
      clientName: 'Acme Corp',
      clientSlug: 'acme-corp',
      audit,
      type: 'internal',
    });

    // Should appear in internal
    expect(internalResult).toContain('Low / Informational');
  });

  it('includes workspace path and audit ID in internal reports only', () => {
    const audit = makeAudit();

    const internal = generateMarkdownReport({
      clientName: 'Acme Corp',
      clientSlug: 'acme-corp',
      audit,
      workspacePath: '/workspace/acme-corp',
      type: 'internal',
    });

    const clientFacing = generateMarkdownReport({
      clientName: 'Acme Corp',
      clientSlug: 'acme-corp',
      audit,
      workspacePath: '/workspace/acme-corp',
      type: 'client-facing',
    });

    expect(internal).toContain('/workspace/acme-corp');
    expect(internal).toContain('audit-abc123');
    expect(clientFacing).not.toContain('/workspace/acme-corp');
    expect(clientFacing).not.toContain('audit-abc123');
  });

  it('lists limitations from the audit', () => {
    const audit = makeAudit({
      limitations: ['Authenticated pages not inspected', 'No staging environment access'],
    });

    const result = generateMarkdownReport({
      clientName: 'Acme Corp',
      clientSlug: 'acme-corp',
      audit,
      type: 'internal',
    });

    expect(result).toContain('Authenticated pages not inspected');
    expect(result).toContain('No staging environment access');
  });

  it('shows Lighthouse audit in inspected section when artifact exists', () => {
    const audit = makeAudit({
      artifactManifest: [
        {
          type: 'lighthouse',
          path: '/evidence/lighthouse.json',
          capturedAt: '2026-01-01T00:01:00.000Z',
        },
        {
          type: 'screenshot',
          path: '/evidence/screenshot.png',
          capturedAt: '2026-01-01T00:01:00.000Z',
        },
      ],
    });

    const result = generateMarkdownReport({
      clientName: 'Acme Corp',
      clientSlug: 'acme-corp',
      audit,
      type: 'internal',
    });

    expect(result).toContain('Lighthouse performance audit');
    expect(result).toContain('1 screenshot(s) captured');
  });
});

describe('generateJsonReport', () => {
  it('returns correct structure for internal report', () => {
    const audit = makeAudit({
      findings: [
        {
          id: 'f1',
          title: 'High issue',
          category: 'performance',
          severity: 'high',
          verificationRequired: true,
          status: 'observed',
          source: 'lighthouse',
          detectedAt: '2026-01-01T00:01:00.000Z',
        },
      ],
    });

    const result = generateJsonReport({
      clientName: 'Acme Corp',
      clientSlug: 'acme-corp',
      audit,
      type: 'internal',
    });

    expect(result.type).toBe('internal');
    expect(result.client).toBe('Acme Corp');
    expect(result.slug).toBe('acme-corp');
    expect(result.auditId).toBe('audit-abc123');
    expect(result.summary.findingsTotal).toBe(1);
    expect(result.summary.findingsBySeverity.high).toBe(1);
    expect(result.summary.findingsBySeverity.low).toBeDefined();
    expect(result.environment).toBeDefined();
  });

  it('omits slug, auditId, and environment for client-facing reports', () => {
    const audit = makeAudit();

    const result = generateJsonReport({
      clientName: 'Acme Corp',
      clientSlug: 'acme-corp',
      audit,
      type: 'client-facing',
    });

    expect(result.type).toBe('client-facing');
    expect(result.slug).toBeUndefined();
    expect(result.auditId).toBeUndefined();
    expect(result.environment).toBeUndefined();
    expect(result.summary.findingsBySeverity.low).toBeUndefined();
    expect(result.summary.findingsBySeverity.info).toBeUndefined();
  });

  it('filters info-severity findings from client-facing findings list', () => {
    const audit = makeAudit({
      findings: [
        {
          id: 'f1',
          title: 'High issue',
          category: 'performance',
          severity: 'high',
          verificationRequired: true,
          status: 'observed',
          source: 'lighthouse',
          detectedAt: '2026-01-01T00:01:00.000Z',
        },
        {
          id: 'f2',
          title: 'Info note',
          category: 'seo',
          severity: 'info',
          verificationRequired: false,
          status: 'observed',
          source: 'inspection',
          detectedAt: '2026-01-01T00:01:00.000Z',
        },
      ],
    });

    const clientResult = generateJsonReport({
      clientName: 'Acme Corp',
      clientSlug: 'acme-corp',
      audit,
      type: 'client-facing',
    });

    // Only high-severity finding should be in the list
    const findingTitles = (clientResult.findings as Array<{ title: string }>).map((f) => f.title);
    expect(findingTitles).toContain('High issue');
    expect(findingTitles).not.toContain('Info note');
  });

  it('returns empty summary when audit is null', () => {
    const result = generateJsonReport({
      clientName: 'Acme Corp',
      clientSlug: 'acme-corp',
      audit: null,
      type: 'internal',
    });

    expect(result.summary.pagesInspected).toBe(0);
    expect(result.summary.findingsTotal).toBe(0);
    expect(result.limitations).toEqual([]);
    expect(result.auditId).toBeUndefined();
  });

  it('includes generatedAt as valid ISO timestamp', () => {
    const result = generateJsonReport({
      clientName: 'Acme Corp',
      clientSlug: 'acme-corp',
      audit: null,
      type: 'internal',
    });

    expect(() => new Date(result.generatedAt)).not.toThrow();
    expect(new Date(result.generatedAt).toISOString()).toBe(result.generatedAt);
  });
});
