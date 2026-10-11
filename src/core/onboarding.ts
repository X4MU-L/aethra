/**
 * Client onboarding pipeline — the staged, resumable workflow that
 * converts a facts directory into a fully scaffolded client workspace.
 */

import path from 'path';
import ora from 'ora';
import chalk from 'chalk';
import { parseFactsDirectory, validateFacts, deriveSlug } from '../engine/facts-parser.js';
import {
  createWorkspaceStructure,
  buildClientConfig,
  buildInitialWorkspaceState,
  writeClientFacts,
  generateReadme,
  generateClaudeMd,
  generateAgentsMd,
  generateKnowledgeBase,
  saveWorkspaceStateFile,
  loadWorkspaceStateFile,
  completeStage,
} from '../engine/workspace.js';
import { saveClientConfig } from '../config/manager.js';
import { runAudit } from '../audit/runner.js';
import { checkAllTools, checkPlaywright, checkLighthouse } from '../engine/tools.js';
import { writeFile, ensureDir, pathExists } from '../engine/fs.js';
import { logger } from './logger.js';
import type { ClientFacts, ClientConfig, WorkspaceState, OnboardingStage } from './schemas.js';

export interface OnboardingOptions {
  factsDir: string;
  clientSlug?: string;
  workspacePath?: string;
  skipAudit?: boolean;
  skipResearch?: boolean;
  resume?: boolean;
  dryRun?: boolean;
}

export interface OnboardingResult {
  success: boolean;
  clientSlug: string;
  workspacePath: string;
  completedStages: OnboardingStage[];
  failedStages: Array<{ stage: OnboardingStage; error: string }>;
  warnings: string[];
  summary: OnboardingSummary;
}

export interface OnboardingSummary {
  discovered: string[];
  generated: string[];
  tested: string[];
  couldNotTest: string[];
  requiresManualSetup: string[];
  recommendedPriorities: string[];
  openQuestions: string[];
  nextCommand: string;
}

/**
 * Run the full client onboarding pipeline.
 * Stages are resumable — a failure in one optional stage does not destroy prior work.
 */
export async function runOnboarding(opts: OnboardingOptions): Promise<OnboardingResult> {
  const completedStages: OnboardingStage[] = [];
  const failedStages: Array<{ stage: OnboardingStage; error: string }> = [];
  const warnings: string[] = [];
  let clientSlug = opts.clientSlug ?? '';
  let workspacePath = opts.workspacePath ?? '';
  let clientConfig: ClientConfig | null = null;
  let facts: Partial<ClientFacts> = {};

  console.log(chalk.bold.blue('\n╔═══════════════════════════════════╗'));
  console.log(chalk.bold.blue('║  Aethra Client Onboarding Pipeline ║'));
  console.log(chalk.bold.blue('╚═══════════════════════════════════╝\n'));

  // ─── Stage 1: Read supplied facts ────────────────────────────────────────
  {
    const spinner = ora('Stage 1: Reading supplied facts...').start();
    try {
      const parseResult = await parseFactsDirectory(opts.factsDir);
      const { valid, facts: validatedFacts, unknowns } = validateFacts(parseResult.facts);

      facts = validatedFacts;
      warnings.push(...parseResult.warnings);

      if (!valid) {
        warnings.push(`Missing fact fields: ${unknowns.join(', ')}`);
      }

      // Determine slug and workspace path
      clientSlug = opts.clientSlug ?? facts.slug ?? deriveSlug(facts.name ?? 'unknown-client');
      facts.slug = clientSlug;

      const { getWorkspaceRoot } = await import('../config/manager.js');
      const workspaceRoot = await getWorkspaceRoot();
      workspacePath = opts.workspacePath ?? path.join(workspaceRoot, clientSlug);

      spinner.succeed(`Stage 1 complete. Client: "${facts.name ?? clientSlug}"`);
      completedStages.push('facts-read');
    } catch (err) {
      spinner.fail(`Stage 1 failed: ${(err as Error).message}`);
      return {
        success: false,
        clientSlug,
        workspacePath,
        completedStages,
        failedStages: [{ stage: 'facts-read', error: (err as Error).message }],
        warnings,
        summary: buildEmptySummary(),
      };
    }
  }

  // Check for existing workspace (resume support)
  let existingState: WorkspaceState | null = null;
  if (await pathExists(workspacePath)) {
    existingState = await loadWorkspaceStateFile(workspacePath);
    if (existingState && !opts.resume) {
      logger.warn(`Workspace already exists at ${workspacePath}. Use --resume to continue.`);
      warnings.push('Workspace exists — resuming. Re-run with fresh facts to start over.');
    }
  }

  // ─── Stage 2: Research and discovery (HTTP check) ────────────────────────
  if (!completedStages.includes('research-discovery' as OnboardingStage)) {
    const spinner = ora('Stage 2: Research and discovery...').start();
    try {
      if (facts.primaryUrl && !opts.skipResearch) {
        const { httpCheck } = await import('../browser/engine.js');
        const result = await httpCheck(facts.primaryUrl);

        if (result.reachable) {
          spinner.succeed(`Stage 2 complete. ${facts.primaryUrl} is reachable (HTTP ${result.status})`);
        } else {
          spinner.warn(`Stage 2 partial. ${facts.primaryUrl} not reachable: ${result.error ?? `HTTP ${result.status}`}`);
          warnings.push(`Primary URL not reachable: ${facts.primaryUrl}`);
        }
      } else {
        spinner.info('Stage 2 skipped — no primary URL or skipResearch set');
      }
      completedStages.push('research-discovery' as OnboardingStage);
    } catch (err) {
      spinner.warn(`Stage 2 partial: ${(err as Error).message}`);
      warnings.push(`Research stage warning: ${(err as Error).message}`);
      completedStages.push('research-discovery' as OnboardingStage);
    }
  }

  // ─── Stage 3: Baseline audit (runs after workspace creation) ──────────────
  // (We create the workspace first, then run audit inside it)

  // ─── Stage 4: Create the client workspace ─────────────────────────────────
  {
    const spinner = ora('Stage 4: Creating client workspace...').start();
    try {
      if (!opts.dryRun) {
        await createWorkspaceStructure(workspacePath);
        clientConfig = buildClientConfig(facts, workspacePath);
        await saveClientConfig(workspacePath, clientConfig);

        // Write knowledge base
        await generateKnowledgeBase(workspacePath, facts, clientConfig);

        // Write primary docs
        await writeFile(path.join(workspacePath, 'README.md'), generateReadme(facts, clientConfig));
        await writeFile(path.join(workspacePath, 'CLAUDE.md'), generateClaudeMd(facts, clientConfig));
        await writeFile(path.join(workspacePath, 'AGENTS.md'), generateAgentsMd(facts, clientConfig));

        // Copy supplied facts into workspace
        await writeClientFacts(workspacePath, facts);

        // Initialise workspace state
        const state = buildInitialWorkspaceState(clientSlug);
        state.completedStages = [...completedStages];
        await saveWorkspaceStateFile(workspacePath, state);
      }

      spinner.succeed(`Stage 4 complete. Workspace: ${workspacePath}`);
      completedStages.push('workspace-created');
      if (!opts.dryRun && clientConfig) {
        await completeStage(workspacePath, 'workspace-created');
      }
    } catch (err) {
      spinner.fail(`Stage 4 failed: ${(err as Error).message}`);
      failedStages.push({ stage: 'workspace-created', error: (err as Error).message });
    }
  }

  // ─── Stage 5: Determine platform and local dev requirements ───────────────
  {
    const spinner = ora('Stage 5: Platform detection...').start();
    try {
      if (facts.knownPlatform) {
        spinner.succeed(`Stage 5: Platform supplied by facts: ${facts.knownPlatform}`);
      }

      // Always write platform setup notes when we have a workspace
      if (clientConfig) {
        const platformDir = path.join(workspacePath, 'platform');
        await ensureDir(platformDir);
        const platformNotes = generatePlatformNotes(facts);
        await writeFile(path.join(platformDir, 'setup-notes.md'), platformNotes);
        if (!facts.knownPlatform) {
          spinner.succeed('Stage 5 complete. Platform notes written.');
        }
      }

      completedStages.push('platform-determined');

      if (clientConfig) {
        await completeStage(workspacePath, 'platform-determined');
      }
    } catch (err) {
      spinner.warn(`Stage 5 partial: ${(err as Error).message}`);
      completedStages.push('platform-determined');
    }
  }

  // ─── Stage 3 (deferred): Baseline audit ───────────────────────────────────
  if (!opts.skipAudit && clientConfig && facts.primaryUrl) {
    const spinner = ora('Stage 3: Running baseline audit...').start();
    try {
      const audit = await runAudit(clientConfig, workspacePath, {
        type: 'baseline',
        maxPages: 5, // Conservative for initial setup
        runLighthouseAudit: true,
        captureScreenshots: true,
      });

      spinner.succeed(
        `Stage 3 complete. Audit ${audit.id}: ${audit.findings.length} findings, ${audit.pagesInspected.length} pages inspected.`,
      );
      completedStages.push('baseline-audit');
      await completeStage(workspacePath, 'baseline-audit');

      if (audit.limitations.length > 0) {
        warnings.push(...audit.limitations);
      }
    } catch (err) {
      spinner.warn(`Stage 3 partial: ${(err as Error).message}`);
      warnings.push(`Audit stage warning: ${(err as Error).message}`);
      completedStages.push('baseline-audit');
      await completeStage(workspacePath, 'baseline-audit').catch(() => {});
    }
  } else if (opts.skipAudit) {
    logger.info('Stage 3 skipped (--skip-audit)');
  }

  // ─── Stage 6: Agent tooling ───────────────────────────────────────────────
  {
    const spinner = ora('Stage 6: Checking agent tooling...').start();
    try {
      const tools = await checkAllTools();
      const playwright = await checkPlaywright();
      const lighthouse = await checkLighthouse();

      const allTools = [...tools, playwright, lighthouse];
      const missing = allTools.filter((t) => t.status === 'missing' && t.required);

      if (missing.length > 0) {
        warnings.push(`Missing required tools: ${missing.map((t) => t.name).join(', ')}`);
      }

      // Write tool manifest to workspace
      if (clientConfig && !opts.dryRun) {
        const { writeJson } = await import('../engine/fs.js');
        await writeJson(
          path.join(workspacePath, '.local', 'tools-manifest.json'),
          { tools: allTools, checkedAt: new Date().toISOString() },
        );
      }

      spinner.succeed(`Stage 6 complete. ${allTools.filter((t) => t.status === 'ok').length}/${allTools.length} tools available.`);
      completedStages.push('agent-tooling');
      if (clientConfig) await completeStage(workspacePath, 'agent-tooling');
    } catch (err) {
      spinner.warn(`Stage 6 partial: ${(err as Error).message}`);
      completedStages.push('agent-tooling');
      if (clientConfig) await completeStage(workspacePath, 'agent-tooling').catch(() => {});
    }
  }

  // ─── Stage 7: Validate and summarise ─────────────────────────────────────
  {
    const spinner = ora('Stage 7: Validating workspace...').start();
    const validationErrors: string[] = [];

    if (clientConfig) {
      const requiredPaths = [
        path.join(workspacePath, 'client.yaml'),
        path.join(workspacePath, 'README.md'),
        path.join(workspacePath, 'CLAUDE.md'),
        path.join(workspacePath, 'knowledge'),
        path.join(workspacePath, 'evidence'),
      ];

      for (const p of requiredPaths) {
        if (!(await pathExists(p))) {
          validationErrors.push(`Missing: ${p}`);
        }
      }
    }

    if (validationErrors.length === 0) {
      spinner.succeed('Stage 7 complete. Workspace validated.');
      completedStages.push('validated');
    } else {
      spinner.warn(`Stage 7 partial. Validation issues: ${validationErrors.join(', ')}`);
    }

    if (clientConfig) {
      await completeStage(workspacePath, 'validated');
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  const summary = buildSummary(facts, completedStages, failedStages, warnings, workspacePath);
  printSummary(summary, clientSlug, workspacePath);

  return {
    success: failedStages.filter((f) => f.stage === 'facts-read' || f.stage === 'workspace-created').length === 0,
    clientSlug,
    workspacePath,
    completedStages,
    failedStages,
    warnings,
    summary,
  };
}

function generatePlatformNotes(facts: Partial<ClientFacts>): string {
  const platform = facts.knownPlatform ?? 'unknown';
  const now = new Date().toISOString().split('T')[0];

  const platformGuides: Record<string, string> = {
    wordpress: `## WordPress Local Development

**Options:**
- **DDEV** (recommended for reproducibility): https://ddev.com
- **LocalWP**: https://localwp.com

**Prerequisites:**
1. A copy of the production database (requires explicit authorisation)
2. The theme and plugin source code
3. Uploaded files (wp-content/uploads) if needed

**DDEV Quick Start:**
\`\`\`bash
mkdir -p wordpress && cd wordpress
ddev config --project-type=wordpress
ddev start
\`\`\`

**Never** download production databases or user data without explicit authorisation.`,

    shopify: `## Shopify Development

Shopify is a hosted platform. Local development uses Shopify CLI.

**Prerequisites:**
- Shopify CLI: \`npm install -g @shopify/cli\`
- A Shopify Partner account (for development stores)
- A development store or staff account

**Theme development:**
\`\`\`bash
shopify theme dev --store=your-store.myshopify.com
\`\`\`

**Never** use production store credentials for development without explicit authorisation.`,

    nextjs: `## Next.js Development

**Setup:**
\`\`\`bash
npm install
npm run dev
\`\`\`

Check the repository README for project-specific setup instructions.`,
  };

  const guide = platformGuides[platform] ?? `## Platform: ${platform}

Platform-specific setup notes will be added as the project progresses.`;

  return `# Platform Setup Notes

**Client:** ${facts.name ?? 'Unknown'}
**Platform:** ${platform}
**Date:** ${now}

${guide}

## Status

- [ ] Repository access confirmed
- [ ] Local environment configured
- [ ] Development database/data prepared
- [ ] Environment variables documented

## Notes

_Add platform-specific notes here as the project progresses._
`;
}

function buildSummary(
  facts: Partial<ClientFacts>,
  completedStages: OnboardingStage[],
  _failedStages: Array<{ stage: OnboardingStage; error: string }>,
  _warnings: string[],
  workspacePath: string,
): OnboardingSummary {
  const discovered: string[] = [];
  const generated: string[] = [];
  const tested: string[] = [];
  const couldNotTest: string[] = [];
  const requiresManualSetup: string[] = [];
  const recommendedPriorities: string[] = [];
  const openQuestions: string[] = [...(facts.openQuestions ?? [])];

  if (facts.name) discovered.push(`Client name: ${facts.name}`);
  if (facts.primaryUrl) discovered.push(`Primary URL: ${facts.primaryUrl}`);
  if (facts.knownPlatform) discovered.push(`Platform: ${facts.knownPlatform}`);
  if (facts.knownIntegrations?.length) discovered.push(`Integrations: ${facts.knownIntegrations.join(', ')}`);

  if (completedStages.includes('workspace-created')) {
    generated.push('Client workspace directory structure');
    generated.push('client.yaml configuration');
    generated.push('README.md, CLAUDE.md, AGENTS.md');
    generated.push('Knowledge base files');
    generated.push('Platform setup notes');
  }

  if (completedStages.includes('baseline-audit')) {
    tested.push('HTTP reachability check');
    tested.push('Platform detection from HTTP headers');
  } else {
    couldNotTest.push('Website audit (URL not configured or audit skipped)');
  }

  if (!facts.primaryUrl) requiresManualSetup.push('Primary URL must be added to client.yaml');
  if (!facts.knownPlatform) requiresManualSetup.push('Platform detection needs repository access or deeper inspection');

  recommendedPriorities.push('Run `aethra audit` to collect baseline evidence');
  if (!facts.primaryUrl) recommendedPriorities.push('Add client website URL to knowledge/client-facts.md');
  recommendedPriorities.push('Review knowledge/open-questions.md and answer outstanding questions');
  recommendedPriorities.push('Set up the local development environment (see platform/setup-notes.md)');

  return {
    discovered,
    generated,
    tested,
    couldNotTest,
    requiresManualSetup,
    recommendedPriorities,
    openQuestions,
    nextCommand: `cd ${workspacePath} && aethra audit`,
  };
}

function buildEmptySummary(): OnboardingSummary {
  return {
    discovered: [],
    generated: [],
    tested: [],
    couldNotTest: [],
    requiresManualSetup: [],
    recommendedPriorities: [],
    openQuestions: [],
    nextCommand: 'aethra setup-client <facts-directory>',
  };
}

function printSummary(
  summary: OnboardingSummary,
  slug: string,
  workspacePath: string,
): void {
  console.log(chalk.bold.green('\n✓ Onboarding complete\n'));
  console.log(chalk.bold('Client:'), slug);
  console.log(chalk.bold('Workspace:'), workspacePath);

  if (summary.discovered.length > 0) {
    console.log(chalk.bold('\nDiscovered:'));
    for (const item of summary.discovered) console.log(chalk.green(`  ✓ ${item}`));
  }

  if (summary.generated.length > 0) {
    console.log(chalk.bold('\nGenerated:'));
    for (const item of summary.generated) console.log(chalk.green(`  ✓ ${item}`));
  }

  if (summary.tested.length > 0) {
    console.log(chalk.bold('\nTested:'));
    for (const item of summary.tested) console.log(chalk.green(`  ✓ ${item}`));
  }

  if (summary.couldNotTest.length > 0) {
    console.log(chalk.bold('\nCould not test:'));
    for (const item of summary.couldNotTest) console.log(chalk.yellow(`  ⚠ ${item}`));
  }

  if (summary.requiresManualSetup.length > 0) {
    console.log(chalk.bold('\nRequires manual setup:'));
    for (const item of summary.requiresManualSetup) console.log(chalk.yellow(`  → ${item}`));
  }

  if (summary.openQuestions.length > 0) {
    console.log(chalk.bold('\nOpen questions:'));
    for (const q of summary.openQuestions.slice(0, 5)) console.log(chalk.gray(`  ? ${q}`));
  }

  if (summary.recommendedPriorities.length > 0) {
    console.log(chalk.bold('\nRecommended next steps:'));
    summary.recommendedPriorities.forEach((p, i) =>
      console.log(chalk.cyan(`  ${i + 1}. ${p}`)),
    );
  }

  console.log(chalk.bold('\nNext command:'));
  console.log(chalk.bold.cyan(`  ${summary.nextCommand}\n`));
}
