/**
 * Workspace creation and management engine.
 * Creates the full client workspace directory structure with valid content.
 */

import path from 'path';
import { ensureDir, writeFile, writeJson, pathExists, readJson } from './fs.js';
import type { ClientFacts, ClientConfig, WorkspaceState } from '../core/schemas.js';
import { ClientConfigSchema, WorkspaceStateSchema } from '../core/schemas.js';
import { logger } from '../core/logger.js';

export const WORKSPACE_DIRS = [
  'client-facts',
  'knowledge',
  'evidence/screenshots',
  'evidence/performance',
  'evidence/accessibility',
  'evidence/browser-tests',
  'evidence/logs',
  'plans',
  'tasks',
  'reports',
  'skills',
  'scripts',
  'platform',
  '.local',
];

/** Create the workspace directory structure for a client. */
export async function createWorkspaceStructure(workspacePath: string): Promise<void> {
  await ensureDir(workspacePath);
  await Promise.all(
    WORKSPACE_DIRS.map((dir) => ensureDir(path.join(workspacePath, dir))),
  );

  // Create a .gitignore inside .local to protect auth state
  await writeFile(
    path.join(workspacePath, '.local', '.gitignore'),
    '# Protected local state — never commit\n*\n!.gitignore\n',
  );
}

/** Generate the client configuration object. */
export function buildClientConfig(
  facts: Partial<ClientFacts>,
  workspacePath: string,
): ClientConfig {
  const now = new Date().toISOString();
  return ClientConfigSchema.parse({
    version: '1',
    slug: facts.slug ?? 'unknown',
    name: facts.name ?? 'Unknown Client',
    createdAt: now,
    updatedAt: now,
    platform: facts.knownPlatform,
    primaryUrl: facts.primaryUrl,
    workspace: workspacePath,
    auditSettings: {
      importantPages: facts.knownUrls?.slice(0, 10) ?? [],
    },
  });
}

/** Generate the workspace state (onboarding progress tracker). */
export function buildInitialWorkspaceState(slug: string): WorkspaceState {
  const now = new Date().toISOString();
  return WorkspaceStateSchema.parse({
    version: '1',
    clientSlug: slug,
    createdAt: now,
    updatedAt: now,
    completedStages: [],
  });
}

/** Write the client facts to the workspace. */
export async function writeClientFacts(
  workspacePath: string,
  facts: Partial<ClientFacts>,
): Promise<void> {
  const factsDir = path.join(workspacePath, 'client-facts');
  await writeJson(path.join(factsDir, 'parsed-facts.json'), facts);
  logger.success('Client facts written to workspace');
}

/** Generate the README.md for a client workspace. */
export function generateReadme(facts: Partial<ClientFacts>, config: ClientConfig): string {
  const name = facts.name ?? 'Unknown Client';
  const url = config.primaryUrl ?? 'TBD';
  const platform = config.platform ?? 'TBD';
  const now = new Date().toISOString().split('T')[0];

  return `# ${name} — Aethra Client Workspace

**Created:** ${now}
**Platform:** ${platform}
**Primary URL:** ${url}
**Slug:** \`${config.slug}\`

## Quick start

\`\`\`bash
# Check workspace and tool availability
aethra doctor

# Run a website audit
aethra audit

# Plan a fix
aethra plan-fix "Describe the task"

# Generate a report
aethra report
\`\`\`

## Workspace structure

| Directory | Purpose |
|-----------|---------|
| \`client-facts/\` | Parsed client facts and input files |
| \`knowledge/\` | Technical findings, decisions, open questions |
| \`evidence/\` | Screenshots, Lighthouse reports, accessibility results |
| \`plans/\` | Implementation plans (created by \`aethra plan-fix\`) |
| \`reports/\` | Engineering and client-facing reports |
| \`skills/\` | Project-specific agent skills |
| \`scripts/\` | Utility scripts for this project |
| \`platform/\` | Platform-specific configuration and notes |
| \`.local/\` | Protected local state (not committed — auth, tmp files) |

## About this client

${facts.description ?? '_No description provided yet._'}

${facts.objectives && facts.objectives.length > 0 ? `## Objectives\n\n${facts.objectives.map((o) => `- ${o}`).join('\n')}` : ''}

${facts.openQuestions && facts.openQuestions.length > 0 ? `## Open questions\n\n${facts.openQuestions.map((q) => `- ${q}`).join('\n')}` : ''}
`;
}

/** Generate CLAUDE.md for the client workspace. */
export function generateClaudeMd(facts: Partial<ClientFacts>, config: ClientConfig): string {
  const name = facts.name ?? 'Unknown Client';
  const url = config.primaryUrl ?? 'TBD';
  const platform = config.platform ?? 'unknown';

  return `# Aethra — ${name} Project Instructions

This workspace was created by the Aethra Client Engineering Workbench.

## Client context

- **Client:** ${name}
- **Platform:** ${platform}
- **Primary URL:** ${url}
- **Workspace:** \`${config.workspace}\`

${facts.description ? `## About the client\n\n${facts.description}\n` : ''}

${facts.objectives && facts.objectives.length > 0
  ? `## Business objectives\n\n${facts.objectives.map((o) => `- ${o}`).join('\n')}\n`
  : ''}

## Technical context

- See \`knowledge/technical-findings.md\` for current technical findings.
- See \`knowledge/architecture.md\` for system architecture notes.
- See \`knowledge/decisions.md\` for approved technical decisions.
- See \`evidence/\` for audit screenshots, Lighthouse reports and accessibility results.

## Available commands

\`\`\`bash
aethra audit              # Run the website audit
aethra audit --refresh    # Refresh the audit
aethra plan-fix "Task"    # Create an implementation plan
aethra apply-fix <plan>   # Apply an approved plan
aethra verify             # Verify against acceptance criteria
aethra report             # Generate a report
\`\`\`

## Skills available

Project-specific skills are in \`skills/\`. Shared Aethra skills are in \`~/.aethra/skills/\`.

## Safety constraints

- **No production mutations** without explicit approval.
- **No commits or pushes** without explicit approval.
- **No destructive operations** on existing data.
- Authentication state is stored in \`.local/\` and must never be logged or committed.
- All audit evidence is local only — do not transmit to external services without approval.

## Evidence and plans

- Plans must not modify source files. Only \`aethra apply-fix\` runs implementation.
- Every plan must reference evidence from the \`evidence/\` directory.
- A claim is only verified if the relevant test actually passed.

## Working directory

When running commands, use this directory as the workspace root: \`${config.workspace}\`

${facts.constraints && facts.constraints.length > 0
  ? `## Constraints\n\n${facts.constraints.map((c) => `- ${c}`).join('\n')}\n`
  : ''}

${facts.openQuestions && facts.openQuestions.length > 0
  ? `## Open questions\n\n${facts.openQuestions.map((q) => `- [ ] ${q}`).join('\n')}\n`
  : ''}
`;
}

/** Generate AGENTS.md for multi-agent context. */
export function generateAgentsMd(facts: Partial<ClientFacts>, config: ClientConfig): string {
  const name = facts.name ?? 'Unknown Client';

  return `# Aethra Agent Configuration — ${name}

This file provides context for AI agents working on the ${name} project.

## Project identity

- **Client:** ${name}
- **Platform:** ${config.platform ?? 'TBD'}
- **URL:** ${config.primaryUrl ?? 'TBD'}
- **Slug:** ${config.slug}

## Agent roles

### Research agent
Investigates the client, technical stack, documentation and implementation options.
Context: read-only access to evidence/, knowledge/, and public web resources.

### Audit agent
Interprets test results, browser evidence, Lighthouse findings and accessibility reports.
Context: read/write evidence/, read knowledge/.

### Planning agent
Creates bounded, evidence-backed implementation plans.
Context: read evidence/, read knowledge/, write plans/.
Constraint: must NOT modify source files.

### Implementation agent
Executes approved plans in the client repository.
Context: read plans/, write to approved repository within feature branch.
Constraint: requires explicit plan approval before source modification.

### Review agent
Reviews implementation changes independently.
Context: read-only access to plans/, diff output.

## Tool permissions by role

| Operation | Research | Audit | Planning | Implementation | Review |
|-----------|----------|-------|----------|----------------|--------|
| Read evidence | ✓ | ✓ | ✓ | ✓ | ✓ |
| Read knowledge | ✓ | ✓ | ✓ | ✓ | ✓ |
| Write evidence | ✗ | ✓ | ✗ | ✗ | ✗ |
| Write plans | ✗ | ✗ | ✓ | ✗ | ✗ |
| Write source | ✗ | ✗ | ✗ | ✓ (approved) | ✗ |
| External network | ✓ (read) | ✓ (read) | ✓ (read) | ✗ | ✗ |
| Git operations | ✗ | ✗ | ✗ | ✓ (branch) | ✗ |

## Shared context location

All shared state is in the workspace directories. Do not rely on conversation memory
for critical project facts — write them to knowledge/ files.

## Definition of done

A task is complete only when:
1. Acceptance criteria from the plan are all verified.
2. Relevant tests pass.
3. Evidence of verification is recorded in evidence/.
4. No regressions in related features.
`;
}

/** Generate the knowledge base files for a new workspace. */
export async function generateKnowledgeBase(
  workspacePath: string,
  facts: Partial<ClientFacts>,
  config: ClientConfig,
): Promise<void> {
  const kbDir = path.join(workspacePath, 'knowledge');
  const name = facts.name ?? 'Unknown Client';
  const now = new Date().toISOString().split('T')[0];

  const files: Record<string, string> = {
    'client-facts.md': `# ${name} — Client Facts

**Last updated:** ${now}
**Source:** Parsed from supplied facts directory

${facts.description ? `## Description\n\n${facts.description}\n` : ''}

## Business objectives

${facts.objectives && facts.objectives.length > 0
  ? facts.objectives.map((o) => `- ${o}`).join('\n')
  : '_Not yet specified._'}

## Target customers

${facts.targetCustomers ?? '_Not yet specified._'}

## Known URLs

${facts.knownUrls && facts.knownUrls.length > 0
  ? facts.knownUrls.map((u) => `- ${u}`).join('\n')
  : '_None provided._'}

## Known integrations

${facts.knownIntegrations && facts.knownIntegrations.length > 0
  ? facts.knownIntegrations.map((i) => `- ${i}`).join('\n')
  : '_None known._'}

## Constraints

${facts.constraints && facts.constraints.length > 0
  ? facts.constraints.map((c) => `- ${c}`).join('\n')
  : '_None specified._'}
`,

    'technical-findings.md': `# ${name} — Technical Findings

**Last updated:** ${now}

_This file is populated by \`aethra audit\` and agent investigation._

## Platform

- **Detected platform:** ${config.platform ?? 'TBD'}
- **Confidence:** ${config.platformConfidence !== undefined ? `${Math.round(config.platformConfidence * 100)}%` : 'TBD'}

## Architecture

_See architecture.md_

## Findings

_Run \`aethra audit\` to populate findings._
`,

    'architecture.md': `# ${name} — Architecture

**Last updated:** ${now}

_Populated by audit and investigation._

## Frontend

_TBD_

## Backend / API

_TBD_

## Database

_TBD_

## Hosting

_TBD_

## Third-party integrations

_TBD_
`,

    'decisions.md': `# ${name} — Technical Decisions

**Last updated:** ${now}

This file records approved technical decisions for the ${name} project.

| Date | Decision | Rationale | Approved by |
|------|----------|-----------|-------------|
| ${now} | Workspace created | Initial onboarding | Aethra workbench |
`,

    'open-questions.md': `# ${name} — Open Questions

**Last updated:** ${now}

${facts.openQuestions && facts.openQuestions.length > 0
  ? facts.openQuestions.map((q) => `- [ ] ${q}`).join('\n')
  : '_No open questions at this time._'}
`,

    'glossary.md': `# ${name} — Glossary

**Last updated:** ${now}

_Add project-specific terms and abbreviations here._

| Term | Definition |
|------|-----------|
`,
  };

  for (const [filename, content] of Object.entries(files)) {
    await writeFile(path.join(kbDir, filename), content);
  }
  logger.success('Knowledge base generated');
}

/**
 * Update knowledge/technical-findings.md with actual audit results.
 * Called after an audit completes to replace the placeholder with real data.
 */
export async function updateTechnicalFindings(
  workspacePath: string,
  auditRun: import('../core/schemas.js').AuditRun,
): Promise<void> {
  const kbDir = path.join(workspacePath, 'knowledge');
  const findingsPath = path.join(kbDir, 'technical-findings.md');
  const now = new Date().toISOString().split('T')[0];

  const findings = auditRun.findings;
  const bySeverity = (sev: string) => findings.filter((f) => f.severity === sev);

  const critical = bySeverity('critical');
  const high = bySeverity('high');
  const medium = bySeverity('medium');
  const low = bySeverity('low');
  const info = bySeverity('info');

  const formatFindings = (list: typeof findings) =>
    list.length > 0
      ? list.map((f) => `- **${f.title}**${f.description ? ` — ${f.description}` : ''}`).join('\n')
      : '_None_';

  const screenshotArtifacts = auditRun.artifactManifest.filter((a) => a.type === 'screenshot');
  const lighthouseArtifact = auditRun.artifactManifest.find((a) => a.type === 'lighthouse');

  const content = `# Technical Findings

**Last updated:** ${now}
**Audit ID:** ${auditRun.id}
**Audit type:** ${auditRun.type}
**Status:** ${auditRun.status}

## Summary

| Severity | Count |
|----------|-------|
| Critical | ${critical.length} |
| High | ${high.length} |
| Medium | ${medium.length} |
| Low | ${low.length} |
| Info | ${info.length} |
| **Total** | **${findings.length}** |

## Pages inspected

${auditRun.pagesInspected.map((p) => `- ${p}`).join('\n') || '_None_'}

## Environment

- **OS:** ${auditRun.environment.os}
- **Node:** ${auditRun.environment.nodeVersion}
- **Playwright:** ${auditRun.environment.playwrightVersion ?? 'n/a'}

## Critical findings

${formatFindings(critical)}

## High priority findings

${formatFindings(high)}

## Medium findings

${formatFindings(medium)}

## Low / Informational

${formatFindings([...low, ...info])}

## Lighthouse scores

${lighthouseArtifact
  ? `Lighthouse report: \`${lighthouseArtifact.path}\``
  : '_Lighthouse not run._'}

## Screenshots

${screenshotArtifacts.length > 0
  ? screenshotArtifacts.map((a) => `- \`${a.path}\` (${a.viewport ?? 'unknown viewport'} — ${a.url})`).join('\n')
  : '_No screenshots captured._'}

## Limitations

${auditRun.limitations.length > 0
  ? auditRun.limitations.map((l) => `- ${l}`).join('\n')
  : '_None recorded._'}

## Errors

${auditRun.errors.length > 0
  ? auditRun.errors.map((e) => `- ${e}`).join('\n')
  : '_None._'}

---

_Generated by \`aethra audit\`. Update manually to add investigation notes._
`;

  await writeFile(findingsPath, content);
  logger.success('Technical findings updated in knowledge base');
}

/**
 * Append or replace the "## Local development status" section in technical-findings.md
 * after a local audit + comparison run.
 */
export async function updateLocalAuditSection(
  workspacePath: string,
  localAudit: import('../core/schemas.js').AuditRun,
  comparison: import('../audit/compare.js').AuditComparison,
): Promise<void> {
  const findingsPath = path.join(workspacePath, 'knowledge', 'technical-findings.md');
  const now = new Date().toISOString().split('T')[0];

  // Build the local status section
  const lhRows = comparison.lighthouseDeltas
    .map((d) => {
      const label = d.category.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
      const base = d.baseline !== null ? String(d.baseline) : 'n/a';
      const local = d.local !== null ? String(d.local) : 'n/a';
      const delta = d.delta !== null ? (d.delta > 0 ? `+${d.delta}` : String(d.delta)) : 'n/a';
      return `| ${label} | ${base} | ${local} | ${delta} |`;
    })
    .join('\n');

  const resolvedList = comparison.findings.resolved.length > 0
    ? comparison.findings.resolved.map((f) => `- ~~${f.title}~~`).join('\n')
    : '_None_';

  const newList = comparison.findings.newIssues.length > 0
    ? comparison.findings.newIssues.map((f) => `- **NEW** ${f.title}`).join('\n')
    : '_None_';

  const localSection = `
## Local development status

**Last local audit:** ${now}
**Local URL:** ${localAudit.targetUrl ?? 'unknown'}
**Local audit ID:** \`${localAudit.id}\`
**Baseline ID:** \`${comparison.baselineId}\`

### vs Baseline

| Category | Baseline | Local | Delta |
|----------|----------|-------|-------|
${lhRows || '| — | — | — | — |'}

### Resolved since baseline

${resolvedList}

### New issues

${newList}

---

_Updated by \`aethra audit --local\`. Re-run to refresh._
`;

  // Read existing content and replace or append the local section
  let existing = '';
  if (await pathExists(findingsPath)) {
    existing = await import('fs-extra').then((fs) => fs.default.readFile(findingsPath, 'utf8'));
  }

  const sectionMarker = '\n## Local development status';
  const idx = existing.indexOf(sectionMarker);
  const updated = idx >= 0
    ? existing.slice(0, idx) + localSection
    : existing + localSection;

  await writeFile(findingsPath, updated);
  logger.success('Local development status updated in knowledge base');
}

/** Save workspace state (onboarding progress). */
export async function saveWorkspaceStateFile(
  workspacePath: string,
  state: WorkspaceState,
): Promise<void> {
  const statePath = path.join(workspacePath, '.local', 'workspace-state.json');
  await writeJson(statePath, state);
}

/** Load workspace state. */
export async function loadWorkspaceStateFile(
  workspacePath: string,
): Promise<WorkspaceState | null> {
  const statePath = path.join(workspacePath, '.local', 'workspace-state.json');
  if (!(await pathExists(statePath))) return null;
  try {
    return await readJson<WorkspaceState>(statePath);
  } catch {
    return null;
  }
}

/** Mark a stage as completed in workspace state. */
export async function completeStage(
  workspacePath: string,
  stage: WorkspaceState['completedStages'][number],
): Promise<void> {
  const state = (await loadWorkspaceStateFile(workspacePath)) ?? buildInitialWorkspaceState('');
  if (!state.completedStages.includes(stage)) {
    state.completedStages.push(stage);
  }
  state.updatedAt = new Date().toISOString();
  await saveWorkspaceStateFile(workspacePath, state);
}
