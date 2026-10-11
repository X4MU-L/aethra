/**
 * Tests for the audit comparison engine (compareAudits).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { compareAudits, extractLighthouseScores } from '../../src/audit/compare.js';
import type { AuditRun } from '../../src/core/schemas.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aethra-compare-test-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Write a fake Lighthouse JSON to tmpDir and return its path. */
async function writeLighthouseJson(
  name: string,
  scores: Record<string, number | null>,
): Promise<string> {
  const categories: Record<string, { score: number | null }> = {};
  for (const [key, score] of Object.entries(scores)) {
    categories[key] = { score: score !== null ? score / 100 : null };
  }
  const reportPath = path.join(tmpDir, `${name}.json`);
  await fs.writeFile(reportPath, JSON.stringify({ categories }), 'utf8');
  return reportPath;
}

/** Minimal AuditRun for testing. */
function makeAudit(overrides: Partial<AuditRun> = {}): AuditRun {
  return {
    id: 'audit-' + Math.random().toString(36).slice(2, 10),
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

// ─── extractLighthouseScores ──────────────────────────────────────────────────

describe('extractLighthouseScores', () => {
  it('returns scores from a valid Lighthouse JSON artifact', async () => {
    const lhPath = await writeLighthouseJson('extract-test', {
      performance: 62,
      accessibility: 94,
      'best-practices': 77,
      seo: 100,
    });

    const audit = makeAudit({
      artifactManifest: [{ path: lhPath, type: 'lighthouse' }],
    });

    const scores = await extractLighthouseScores(audit);
    expect(scores.performance).toBe(62);
    expect(scores.accessibility).toBe(94);
    expect(scores['best-practices']).toBe(77);
    expect(scores.seo).toBe(100);
  });

  it('returns empty object when no lighthouse artifact exists', async () => {
    const audit = makeAudit({ artifactManifest: [] });
    const scores = await extractLighthouseScores(audit);
    expect(scores).toEqual({});
  });

  it('returns empty object when artifact file does not exist on disk', async () => {
    const audit = makeAudit({
      artifactManifest: [{ path: '/nonexistent/path/lighthouse.json', type: 'lighthouse' }],
    });
    const scores = await extractLighthouseScores(audit);
    expect(scores).toEqual({});
  });

  it('handles null scores gracefully (omits them)', async () => {
    const lhPath = await writeLighthouseJson('null-score-test', {
      performance: 80,
      accessibility: null,
    });
    const audit = makeAudit({
      artifactManifest: [{ path: lhPath, type: 'lighthouse' }],
    });
    const scores = await extractLighthouseScores(audit);
    expect(scores.performance).toBe(80);
    expect(scores.accessibility).toBeUndefined();
  });
});

// ─── compareAudits ────────────────────────────────────────────────────────────

describe('compareAudits', () => {
  it('correctly identifies resolved findings (in baseline, not in local)', async () => {
    const baseline = makeAudit({
      findings: [
        { id: 'f1', category: 'technical', severity: 'medium', title: 'Console errors on /about', status: 'observed', evidence: [], verificationRequired: true },
        { id: 'f2', category: 'performance', severity: 'high', title: 'Slow LCP', status: 'observed', evidence: [], verificationRequired: true },
      ],
    });
    const local = makeAudit({
      type: 'local',
      findings: [
        // 'Slow LCP' fixed locally; 'Console errors on /about' remains
        { id: 'f3', category: 'technical', severity: 'medium', title: 'Console errors on /about', status: 'observed', evidence: [], verificationRequired: true },
      ],
    });

    const result = await compareAudits(baseline, local);
    expect(result.findings.resolved).toHaveLength(1);
    expect(result.findings.resolved[0]!.title).toBe('Slow LCP');
    expect(result.findings.remaining).toHaveLength(1);
    expect(result.findings.remaining[0]!.title).toBe('Console errors on /about');
    expect(result.findings.newIssues).toHaveLength(0);
  });

  it('correctly identifies new issues (in local, not in baseline)', async () => {
    const baseline = makeAudit({ findings: [] });
    const local = makeAudit({
      type: 'local',
      findings: [
        { id: 'f1', category: 'technical', severity: 'high', title: 'New memory leak detected', status: 'observed', evidence: [], verificationRequired: true },
      ],
    });

    const result = await compareAudits(baseline, local);
    expect(result.findings.newIssues).toHaveLength(1);
    expect(result.findings.newIssues[0]!.title).toBe('New memory leak detected');
    expect(result.findings.resolved).toHaveLength(0);
  });

  it('calculates lighthouse deltas correctly', async () => {
    const baselineLhPath = await writeLighthouseJson('baseline-lh', { performance: 52, accessibility: 94 });
    const localLhPath = await writeLighthouseJson('local-lh', { performance: 78, accessibility: 96 });

    const baseline = makeAudit({
      artifactManifest: [{ path: baselineLhPath, type: 'lighthouse' }],
    });
    const local = makeAudit({
      type: 'local',
      artifactManifest: [{ path: localLhPath, type: 'lighthouse' }],
    });

    const result = await compareAudits(baseline, local);
    const perfDelta = result.lighthouseDeltas.find((d) => d.category === 'performance');
    expect(perfDelta?.baseline).toBe(52);
    expect(perfDelta?.local).toBe(78);
    expect(perfDelta?.delta).toBe(26);
    expect(perfDelta?.improved).toBe(true);

    const a11yDelta = result.lighthouseDeltas.find((d) => d.category === 'accessibility');
    expect(a11yDelta?.delta).toBe(2);
    expect(a11yDelta?.improved).toBe(true);
  });

  it('handles null deltas when baseline has no lighthouse data', async () => {
    const localLhPath = await writeLighthouseJson('local-only-lh', { performance: 78 });

    const baseline = makeAudit({ artifactManifest: [] });
    const local = makeAudit({
      type: 'local',
      artifactManifest: [{ path: localLhPath, type: 'lighthouse' }],
    });

    const result = await compareAudits(baseline, local);
    const perfDelta = result.lighthouseDeltas.find((d) => d.category === 'performance');
    expect(perfDelta?.baseline).toBeNull();
    expect(perfDelta?.local).toBe(78);
    expect(perfDelta?.delta).toBeNull();
    expect(perfDelta?.improved).toBe(false);
  });

  it('sets performanceImproved=true when performance delta is positive', async () => {
    const baselineLhPath = await writeLighthouseJson('perf-base', { performance: 50 });
    const localLhPath = await writeLighthouseJson('perf-local', { performance: 80 });

    const baseline = makeAudit({ artifactManifest: [{ path: baselineLhPath, type: 'lighthouse' }] });
    const local = makeAudit({ type: 'local', artifactManifest: [{ path: localLhPath, type: 'lighthouse' }] });

    const result = await compareAudits(baseline, local);
    expect(result.summary.performanceImproved).toBe(true);
  });

  it('sets performanceImproved=false when performance worsened', async () => {
    const baselineLhPath = await writeLighthouseJson('perf-base2', { performance: 80 });
    const localLhPath = await writeLighthouseJson('perf-local2', { performance: 60 });

    const baseline = makeAudit({ artifactManifest: [{ path: baselineLhPath, type: 'lighthouse' }] });
    const local = makeAudit({ type: 'local', artifactManifest: [{ path: localLhPath, type: 'lighthouse' }] });

    const result = await compareAudits(baseline, local);
    expect(result.summary.performanceImproved).toBe(false);
  });

  it('uses case-insensitive title matching for finding resolution', async () => {
    const baseline = makeAudit({
      findings: [
        { id: 'f1', category: 'technical', severity: 'medium', title: 'Console Errors on /About', status: 'observed', evidence: [], verificationRequired: true },
      ],
    });
    const local = makeAudit({
      type: 'local',
      findings: [
        // Same finding with different capitalisation
        { id: 'f2', category: 'technical', severity: 'medium', title: 'console errors on /about', status: 'observed', evidence: [], verificationRequired: true },
      ],
    });

    const result = await compareAudits(baseline, local);
    // Should match as "remaining" not "resolved + new"
    expect(result.findings.resolved).toHaveLength(0);
    expect(result.findings.remaining).toHaveLength(1);
    expect(result.findings.newIssues).toHaveLength(0);
  });

  it('returns correct IDs and comparedAt timestamp', async () => {
    const baseline = makeAudit({ id: 'audit-baseline-abc' });
    const local = makeAudit({ id: 'audit-local-xyz', type: 'local' });

    const before = Date.now();
    const result = await compareAudits(baseline, local);
    const after = Date.now();

    expect(result.baselineId).toBe('audit-baseline-abc');
    expect(result.localId).toBe('audit-local-xyz');
    const ts = new Date(result.comparedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('summary counts match findings arrays', async () => {
    const baseline = makeAudit({
      findings: [
        { id: 'f1', category: 'tech', severity: 'medium', title: 'Bug A', status: 'observed', evidence: [], verificationRequired: true },
        { id: 'f2', category: 'tech', severity: 'low', title: 'Bug B', status: 'observed', evidence: [], verificationRequired: true },
      ],
    });
    const local = makeAudit({
      type: 'local',
      findings: [
        // Bug A resolved, Bug C is new
        { id: 'f3', category: 'tech', severity: 'high', title: 'Bug C', status: 'observed', evidence: [], verificationRequired: true },
      ],
    });

    const result = await compareAudits(baseline, local);
    expect(result.summary.resolvedCount).toBe(result.findings.resolved.length);
    expect(result.summary.newIssueCount).toBe(result.findings.newIssues.length);
    expect(result.summary.resolvedCount).toBe(2); // Bug A and Bug B resolved
    expect(result.summary.newIssueCount).toBe(1); // Bug C is new
  });

  it('sorts lighthouse deltas in standard category order', async () => {
    const lhPath = await writeLighthouseJson('sorted-lh', {
      seo: 100,
      'best-practices': 77,
      accessibility: 94,
      performance: 52,
    });

    const baseline = makeAudit({ artifactManifest: [] });
    const local = makeAudit({
      type: 'local',
      artifactManifest: [{ path: lhPath, type: 'lighthouse' }],
    });

    const result = await compareAudits(baseline, local);
    const categories = result.lighthouseDeltas.map((d) => d.category);
    expect(categories).toEqual(['performance', 'accessibility', 'best-practices', 'seo']);
  });
});
