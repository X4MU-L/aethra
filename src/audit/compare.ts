/**
 * Audit comparison engine.
 * Compares two AuditRun objects (e.g. baseline vs local) and returns a structured diff.
 */

import { readJson, pathExists } from '../engine/fs.js';
import type { AuditRun, Finding } from '../core/schemas.js';

export interface LighthouseDelta {
  category: string;
  baseline: number | null;
  local: number | null;
  delta: number | null; // local - baseline; null when either score is missing
  improved: boolean;
}

export interface AuditComparison {
  baselineId: string;
  localId: string;
  comparedAt: string;
  lighthouseDeltas: LighthouseDelta[];
  findings: {
    resolved: Finding[]; // in baseline but absent from local (by normalised title)
    newIssues: Finding[]; // in local but absent from baseline
    remaining: Finding[]; // in both
  };
  pagesStatus: Array<{
    url: string;
    inspectedLocally: boolean;
    note?: string;
  }>;
  summary: {
    performanceImproved: boolean;
    newIssueCount: number;
    resolvedCount: number;
  };
}

/** Extract Lighthouse category scores from the audit's Lighthouse artifact JSON. */
export async function extractLighthouseScores(
  auditRun: AuditRun,
): Promise<Record<string, number>> {
  const lhArtifact = auditRun.artifactManifest.find((a) => a.type === 'lighthouse');
  if (!lhArtifact || !(await pathExists(lhArtifact.path))) return {};

  try {
    const report = await readJson<{ categories?: Record<string, { score: number | null }> }>(
      lhArtifact.path,
    );
    const scores: Record<string, number> = {};
    for (const [key, cat] of Object.entries(report.categories ?? {})) {
      if (cat.score !== null) scores[key] = Math.round(cat.score * 100);
    }
    return scores;
  } catch {
    return {};
  }
}

/** Normalise a finding title for comparison (lowercase, trimmed). */
function normaliseTitle(title: string): string {
  return title.toLowerCase().trim();
}

/** Compare two audit runs and return a structured diff. */
export async function compareAudits(
  baseline: AuditRun,
  local: AuditRun,
): Promise<AuditComparison> {
  const comparedAt = new Date().toISOString();

  // Extract Lighthouse scores from both runs' artifact files
  const [baselineScores, localScores] = await Promise.all([
    extractLighthouseScores(baseline),
    extractLighthouseScores(local),
  ]);

  // Compute deltas for all categories present in either run
  const allCategories = new Set([
    ...Object.keys(baselineScores),
    ...Object.keys(localScores),
  ]);

  const categoryOrder = ['performance', 'accessibility', 'best-practices', 'seo'];
  const lighthouseDeltas: LighthouseDelta[] = Array.from(allCategories)
    .map((category) => {
      const b = baselineScores[category] ?? null;
      const l = localScores[category] ?? null;
      const delta = b !== null && l !== null ? l - b : null;
      return {
        category,
        baseline: b,
        local: l,
        delta,
        improved: delta !== null && delta > 0,
      };
    })
    .sort((a, b) => {
      const ai = categoryOrder.indexOf(a.category);
      const bi = categoryOrder.indexOf(b.category);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.category.localeCompare(b.category);
    });

  // Compare findings by normalised title
  const baselineTitles = new Set(baseline.findings.map((f) => normaliseTitle(f.title)));
  const localTitles = new Set(local.findings.map((f) => normaliseTitle(f.title)));

  const resolved = baseline.findings.filter((f) => !localTitles.has(normaliseTitle(f.title)));
  const newIssues = local.findings.filter((f) => !baselineTitles.has(normaliseTitle(f.title)));
  const remaining = local.findings.filter((f) => baselineTitles.has(normaliseTitle(f.title)));

  // Pages status — track which production pages were also inspected locally
  const allPages = new Set([...baseline.pagesInspected, ...local.pagesInspected]);
  const pagesStatus = Array.from(allPages).map((url) => ({
    url,
    inspectedLocally: local.pagesInspected.includes(url),
    note: !local.pagesInspected.includes(url) ? 'Not inspected in local run' : undefined,
  }));

  const perfDelta = lighthouseDeltas.find((d) => d.category === 'performance');
  const performanceImproved = perfDelta?.improved ?? false;

  return {
    baselineId: baseline.id,
    localId: local.id,
    comparedAt,
    lighthouseDeltas,
    findings: { resolved, newIssues, remaining },
    pagesStatus,
    summary: {
      performanceImproved,
      newIssueCount: newIssues.length,
      resolvedCount: resolved.length,
    },
  };
}
