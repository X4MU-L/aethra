/**
 * Report generation logic.
 * Converts audit data into human-readable Markdown or machine-readable JSON reports.
 * Separated from the CLI command for testability.
 */

import type { AuditRun, Finding } from '../core/schemas.js';

export type ReportType = 'internal' | 'client-facing';

export interface ReportInput {
  clientName: string;
  clientSlug: string;
  audit: AuditRun | null;
  workspacePath?: string;
  type: ReportType;
}

export interface JsonReport {
  type: ReportType;
  generatedAt: string;
  client: string;
  slug?: string;
  auditId?: string;
  summary: {
    pagesInspected: number;
    findingsTotal: number;
    findingsBySeverity: {
      critical: number;
      high: number;
      medium: number;
      low?: number;
      info?: number;
    };
  };
  findings: Finding[] | Array<{
    title: string;
    severity: string;
    category: string;
    description?: string;
    recommendation?: string;
  }>;
  limitations: string[];
  environment?: AuditRun['environment'];
}

/**
 * Generate a Markdown report.
 */
export function generateMarkdownReport(input: ReportInput): string {
  const { clientName, clientSlug, audit, workspacePath, type } = input;
  const isClient = type === 'client-facing';
  const now = new Date().toISOString().split('T')[0];

  const findings = audit?.findings ?? [];
  const highPriority = findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
  const medium = findings.filter((f) => f.severity === 'medium');
  const low = findings.filter((f) => f.severity === 'low' || f.severity === 'info');

  const sections: string[] = [];

  sections.push(`# ${isClient ? 'Technical Review' : 'Engineering Report'} — ${clientName}`);
  sections.push(`\n**Date:** ${now}  \n**Status:** ${audit ? audit.status : 'No audit available'}`);

  if (!isClient && workspacePath) {
    sections.push(`\n**Client slug:** ${clientSlug}  \n**Workspace:** ${workspacePath}`);
    if (audit) {
      sections.push(`\n**Audit ID:** ${audit.id}  \n**Audit type:** ${audit.type}  \n**Environment:** ${audit.environment.os}`);
    }
  }

  // Executive summary
  sections.push('\n## Executive summary\n');
  if (audit) {
    sections.push(
      `${findings.length} findings were identified during the technical review of ${clientName}.` +
      (highPriority.length > 0
        ? ` **${highPriority.length} require priority attention.**`
        : ' No critical or high-priority issues were found.'),
    );
  } else {
    sections.push('No audit data available. Run `aethra audit` to generate baseline evidence.');
  }

  // What was inspected
  sections.push('\n## What was inspected\n');
  if (audit) {
    sections.push(`- ${audit.pagesInspected.length} page(s) inspected`);
    const screenshotCount = audit.artifactManifest.filter((a) => a.type === 'screenshot').length;
    const lighthouseRan = audit.artifactManifest.some((a) => a.type === 'lighthouse');
    sections.push(`- ${screenshotCount} screenshot(s) captured`);
    sections.push(`- ${lighthouseRan ? 'Lighthouse performance audit' : 'Lighthouse not run'}`);
    sections.push('- HTTP reachability check');
    sections.push('- Platform detection');
  } else {
    sections.push('_No inspection data available._');
  }

  // What was not inspected
  sections.push('\n## What was not inspected\n');
  const notInspected = [
    'Authenticated user journeys',
    'Backend API endpoints',
    'Database performance',
  ];
  if (audit?.limitations) notInspected.push(...audit.limitations);
  for (const item of notInspected) sections.push(`- ${item}`);

  // Findings
  if (findings.length > 0) {
    sections.push('\n## Findings\n');

    if (highPriority.length > 0) {
      sections.push('### Critical / High priority\n');
      for (const f of highPriority) {
        sections.push(`#### ${f.title}`);
        sections.push(`\n- **Severity:** ${f.severity.toUpperCase()}`);
        sections.push(`- **Category:** ${f.category}`);
        if (f.description) sections.push(`- **Description:** ${f.description}`);
        if (f.recommendation) sections.push(`- **Recommendation:** ${f.recommendation}`);
        sections.push(`- **Verification required:** ${f.verificationRequired ? 'Yes' : 'No'}\n`);
      }
    }

    if (medium.length > 0) {
      sections.push('### Medium priority\n');
      for (const f of medium) {
        sections.push(`- **[MEDIUM]** ${f.title}${f.description ? `: ${f.description.slice(0, 100)}` : ''}`);
      }
      sections.push('');
    }

    if (!isClient && low.length > 0) {
      sections.push('### Low / Informational (internal only)\n');
      for (const f of low) {
        sections.push(`- **[${f.severity.toUpperCase()}]** ${f.title}`);
      }
      sections.push('');
    }
  }

  // Recommended priorities
  sections.push('\n## Recommended priorities\n');
  sections.push('1. Address any critical or high-priority findings first');
  sections.push('2. Review screenshots and Lighthouse reports in the evidence directory');
  sections.push('3. Set up local development environment');
  sections.push('4. Plan specific feature improvements based on findings');

  // Next steps
  sections.push('\n## Next steps\n');
  sections.push('```bash');
  sections.push(`aethra plan-fix "Address high-priority findings"`);
  sections.push('```');

  // Footer
  if (!isClient) {
    sections.push('\n---\n\n_Generated by Aethra Client Engineering Workbench_  \n_Internal use only — do not distribute without review_');
  } else {
    sections.push('\n---\n\n_Prepared by Aethra Solutions_');
  }

  return sections.join('\n');
}

/**
 * Generate a JSON report.
 */
export function generateJsonReport(input: ReportInput): JsonReport {
  const { clientName, clientSlug, audit, type } = input;
  const isClient = type === 'client-facing';
  const findings = audit?.findings ?? [];

  return {
    type,
    generatedAt: new Date().toISOString(),
    client: clientName,
    slug: isClient ? undefined : clientSlug,
    auditId: isClient ? undefined : audit?.id,
    summary: {
      pagesInspected: audit?.pagesInspected.length ?? 0,
      findingsTotal: findings.length,
      findingsBySeverity: {
        critical: findings.filter((f) => f.severity === 'critical').length,
        high: findings.filter((f) => f.severity === 'high').length,
        medium: findings.filter((f) => f.severity === 'medium').length,
        low: isClient ? undefined : findings.filter((f) => f.severity === 'low').length,
        info: isClient ? undefined : findings.filter((f) => f.severity === 'info').length,
      },
    },
    findings: isClient
      ? findings
          .filter((f) => f.severity !== 'info')
          .map((f) => ({
            title: f.title,
            severity: f.severity,
            category: f.category,
            description: f.description,
            recommendation: f.recommendation,
          }))
      : findings,
    limitations: audit?.limitations ?? [],
    environment: isClient ? undefined : audit?.environment,
  };
}
