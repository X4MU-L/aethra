/**
 * `aethra investigate "<description>"` — assemble evidence and produce an
 * investigation brief for an agent to complete.
 *
 * This is the critical step between audit evidence and an actionable plan.
 * It:
 *   1. Loads the latest audit findings and Lighthouse scores
 *   2. Reads relevant knowledge base files
 *   3. Selects 2-4 skills appropriate for the task and platform
 *   4. Writes a structured investigation.md the agent fills in
 *   5. Optionally attaches to an existing task (--task <id>)
 *
 * IMPORTANT: This command does NOT modify source files.
 * It prepares context for an agent to investigate.
 */

import type { Command } from 'commander';
import path from 'path';
import chalk from 'chalk';
import crypto from 'crypto';
import fs from 'fs-extra';
import { resolveClientWorkspace } from '../../config/manager.js';
import { loadLatestAudit } from '../../audit/runner.js';
import { extractLighthouseScores } from '../../audit/compare.js';
import { findTaskByPrefix, updateTask } from '../../engine/tasks.js';
import { selectSkillsForTask } from '../../engine/context.js';
import { writeFile, ensureDir, pathExists } from '../../engine/fs.js';
import { logger } from '../../core/logger.js';
import { toAethraError } from '../../core/errors.js';

export function registerInvestigateCommand(program: Command): void {
  program
    .command('investigate [description]')
    .description('Assemble evidence and produce an investigation brief for an agent')
    .option('--client <slug>', 'Specify client by slug')
    .option('--task <id>', 'Attach this investigation to an existing task')
    .option('--json', 'Output brief metadata as JSON')
    .action(async (description: string | undefined, opts, cmd) => {
      const clientSlug = opts.client ?? cmd.parent?.opts()?.client;
      const jsonMode = opts.json || cmd.parent?.opts()?.json;

      try {
        const { config, workspacePath } = await resolveClientWorkspace(clientSlug);

        // ─── Resolve task (if --task given) ─────────────────────────────────
        let taskRecord = opts.task
          ? await findTaskByPrefix(workspacePath, opts.task as string)
          : null;

        if (opts.task && !taskRecord) {
          logger.error(`Task not found: ${opts.task}`);
          process.exit(1);
        }

        // Use task title if no description given
        const investigationTitle = description ?? taskRecord?.title;
        if (!investigationTitle) {
          logger.error('Provide a description or use --task <id> to attach to an existing task.');
          process.exit(1);
        }

        if (!jsonMode) {
          console.log(chalk.bold.blue(`\n  Investigate — ${config.name}\n`));
          console.log(chalk.gray(`  Topic: ${investigationTitle}\n`));
        }

        // ─── Load audit evidence ─────────────────────────────────────────────
        const evidenceDir = path.join(workspacePath, 'evidence');
        const audit = await loadLatestAudit(evidenceDir, 'baseline');

        let lhScores: Record<string, number> = {};
        if (audit) {
          lhScores = await extractLighthouseScores(audit);
        }

        // ─── Load knowledge base ─────────────────────────────────────────────
        const kbDir = path.join(workspacePath, 'knowledge');
        const kbFiles: Array<{ filename: string; content: string }> = [];
        const kbFilenames = [
          'technical-findings.md',
          'architecture.md',
          'open-questions.md',
        ];
        for (const fname of kbFilenames) {
          const fp = path.join(kbDir, fname);
          if (await pathExists(fp)) {
            const raw = await fs.readFile(fp, 'utf8');
            // Only include if it has real content (not just the stub placeholder)
            if (raw.trim().length > 100) {
              kbFiles.push({ filename: fname, content: raw.trim() });
            }
          }
        }

        // ─── Select skills ───────────────────────────────────────────────────
        const clientSkillsDir = path.join(workspacePath, 'skills');
        const skillSelection = await selectSkillsForTask(
          investigationTitle,
          config.platform,
          'investigate',
          clientSkillsDir,
        );

        if (!jsonMode) {
          console.log(chalk.gray(`  Skills selected: ${skillSelection.selectedSkills.map((s) => s.name).join(', ') || 'none'}`));
          if (audit) {
            console.log(chalk.gray(`  Audit: ${audit.id} (${audit.findings.length} findings, ${audit.pagesInspected.length} pages)`));
          }
          console.log();
        }

        // ─── Determine output path ───────────────────────────────────────────
        let briefPath: string;
        if (taskRecord) {
          const taskDirPath = path.join(workspacePath, 'tasks', taskRecord.id);
          await ensureDir(taskDirPath);
          briefPath = path.join(taskDirPath, 'investigation.md');
        } else {
          const investigationsDir = path.join(kbDir, 'investigations');
          await ensureDir(investigationsDir);
          const slug = investigationTitle
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .slice(0, 40);
          const id = crypto.randomBytes(4).toString('hex');
          briefPath = path.join(investigationsDir, `${slug}-${id}.md`);
        }

        // ─── Generate investigation brief ────────────────────────────────────
        const briefContent = generateInvestigationBrief({
          title: investigationTitle,
          taskId: taskRecord?.id,
          clientName: config.name,
          platform: config.platform,
          audit,
          lhScores,
          kbFiles,
          skillSelection: skillSelection.selectedSkills,
          excludedSkills: skillSelection.excluded,
          selectionRationale: skillSelection.selectionRationale,
        });

        await writeFile(briefPath, briefContent);

        // Attach to task: save briefPath in task notes and mark as 'planned'
        // (we don't change status — investigation can happen at 'planned' stage)
        if (taskRecord) {
          await updateTask(workspacePath, taskRecord.id, {
            notes: `Investigation brief: ${briefPath}`,
          });
        }

        // ─── Output ──────────────────────────────────────────────────────────
        const result = {
          briefPath,
          taskId: taskRecord?.id,
          investigationTitle,
          auditId: audit?.id,
          findingsCount: audit?.findings.length ?? 0,
          skillsSelected: skillSelection.selectedSkills.map((s) => s.name),
          selectionRationale: skillSelection.selectionRationale,
        };

        if (jsonMode) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(chalk.bold.green(`  ✓ Investigation brief written\n`));
        console.log(`  Brief: ${chalk.cyan(briefPath)}`);
        if (taskRecord) {
          console.log(`  Task:  ${taskRecord.id.slice(0, 8)} — ${taskRecord.title}`);
        }

        console.log(chalk.bold('\n  Selected skills:\n'));
        for (const skill of skillSelection.selectedSkills) {
          console.log(`  ${chalk.cyan(skill.name)}`);
          console.log(chalk.gray(`    ${skill.description.slice(0, 80)}`));
          console.log(chalk.gray(`    Path: ${skill.filePath}`));
          console.log(chalk.gray(`    Why: ${skill.reason}`));
          console.log();
        }

        if (skillSelection.excluded.length > 0) {
          console.log(chalk.gray(`  Excluded (not relevant): ${skillSelection.excluded.join(', ')}\n`));
        }

        console.log(chalk.bold('  Next steps:\n'));
        console.log(chalk.gray(`  1. Open the brief with an AI agent:`));
        console.log(chalk.cyan(`\n     # In Claude Code or your agent:`));
        console.log(chalk.cyan(`     Read: ${briefPath}`));
        for (const skill of skillSelection.selectedSkills) {
          console.log(chalk.cyan(`     Read: ${skill.filePath}`));
        }
        console.log();
        console.log(chalk.gray('  2. The agent fills in: root cause, affected files, proposed solution'));
        if (taskRecord) {
          console.log(chalk.gray(`  3. Review plan: ${path.join(workspacePath, 'plans')}/`));
          console.log(chalk.gray(`  4. Approve: aethra task approve ${taskRecord.id.slice(0, 8)}\n`));
        } else {
          console.log(chalk.gray('  3. Run: aethra plan-fix "<description>" to create a task\n'));
        }
      } catch (err) {
        const e = toAethraError(err);
        logger.error(`investigate failed: ${e.message}`);
        process.exit(e.exitCode);
      }
    });
}

// ─── Brief generation ─────────────────────────────────────────────────────────

interface BriefInput {
  title: string;
  taskId?: string;
  clientName: string;
  platform?: string;
  audit: Awaited<ReturnType<typeof loadLatestAudit>>;
  lhScores: Record<string, number>;
  kbFiles: Array<{ filename: string; content: string }>;
  skillSelection: Array<{ name: string; filePath: string; description: string; reason: string }>;
  excludedSkills: string[];
  selectionRationale: string;
}

function generateInvestigationBrief(input: BriefInput): string {
  const {
    title, taskId, clientName, platform, audit, lhScores,
    kbFiles, skillSelection, excludedSkills, selectionRationale,
  } = input;

  const now = new Date().toISOString().split('T')[0];
  const lines: string[] = [];

  lines.push(`# Investigation Brief: ${title}`);
  lines.push('');
  lines.push(`**Client:** ${clientName}`);
  if (taskId) lines.push(`**Task ID:** ${taskId.slice(0, 8)}`);
  lines.push(`**Date:** ${now}`);
  lines.push(`**Platform:** ${platform ?? 'unknown'}`);
  lines.push('');
  lines.push('> **Agent instructions:** Fill in the sections marked _To be determined_ based on');
  lines.push('> the evidence below and your code investigation. Do not modify source files during investigation.');
  lines.push('');

  // ── Evidence from audit ────────────────────────────────────────────────────
  lines.push('## Evidence from baseline audit');
  lines.push('');

  if (!audit) {
    lines.push('_No baseline audit found. Run `aethra audit` before investigating._');
    lines.push('');
  } else {
    lines.push(`**Audit ID:** ${audit.id}  `);
    lines.push(`**Status:** ${audit.status}  `);
    lines.push(`**Completed:** ${audit.completedAt ?? 'n/a'}  `);
    lines.push(`**Target URL:** ${audit.targetUrl ?? 'n/a'}  `);
    lines.push('');

    // Lighthouse scores
    if (Object.keys(lhScores).length > 0) {
      lines.push('### Lighthouse scores');
      lines.push('');
      lines.push('| Category | Score | Status |');
      lines.push('|----------|-------|--------|');
      const categoryOrder = ['performance', 'accessibility', 'best-practices', 'seo'];
      const orderedEntries = [
        ...categoryOrder.filter((c) => c in lhScores).map((c) => [c, lhScores[c]!] as [string, number]),
        ...Object.entries(lhScores).filter(([c]) => !categoryOrder.includes(c)),
      ];
      for (const [category, score] of orderedEntries) {
        const label = category.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
        const status = score >= 90 ? '✓ Good' : score >= 75 ? '⚠ Needs work' : '✗ Poor';
        lines.push(`| ${label} | ${score}/100 | ${status} |`);
      }
      lines.push('');
    }

    // Findings
    lines.push('### Findings by severity');
    lines.push('');
    if (audit.findings.length === 0) {
      lines.push('_No findings in baseline audit._');
    } else {
      const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
      for (const sev of severityOrder) {
        const group = audit.findings.filter((f) => f.severity === sev);
        if (group.length === 0) continue;
        lines.push(`**${sev.toUpperCase()}** (${group.length})`);
        lines.push('');
        for (const finding of group) {
          lines.push(`- **${finding.title}**`);
          if (finding.description) {
            lines.push(`  ${finding.description.slice(0, 200)}`);
          }
        }
        lines.push('');
      }
    }

    // Pages inspected
    lines.push('### Pages inspected');
    lines.push('');
    if (audit.pagesInspected.length > 0) {
      for (const page of audit.pagesInspected) {
        lines.push(`- ${page}`);
      }
    } else {
      lines.push('_No pages inspected._');
    }
    lines.push('');

    // Errors and limitations
    if (audit.errors.length > 0) {
      lines.push('### Audit errors');
      lines.push('');
      for (const e of audit.errors) lines.push(`- ${e}`);
      lines.push('');
    }
    if (audit.limitations.length > 0) {
      lines.push('### Audit limitations');
      lines.push('');
      for (const l of audit.limitations) lines.push(`- ${l}`);
      lines.push('');
    }

    // Evidence artifact paths
    lines.push('### Evidence artifact paths');
    lines.push('');
    const screenshots = audit.artifactManifest.filter((a) => a.type === 'screenshot');
    const lhArtifact = audit.artifactManifest.find((a) => a.type === 'lighthouse');
    if (lhArtifact) lines.push(`- Lighthouse report: \`${lhArtifact.path}\``);
    if (screenshots.length > 0) {
      lines.push(`- Screenshots (${screenshots.length}):`);
      for (const s of screenshots.slice(0, 6)) {
        lines.push(`  - \`${s.path}\` (${s.viewport ?? 'unknown'} — ${s.url})`);
      }
      if (screenshots.length > 6) lines.push(`  - … and ${screenshots.length - 6} more`);
    }
    lines.push('');
  }

  // ── Knowledge base ─────────────────────────────────────────────────────────
  if (kbFiles.length > 0) {
    lines.push('## Knowledge base context');
    lines.push('');
    for (const kbFile of kbFiles) {
      lines.push(`### ${kbFile.filename}`);
      lines.push('');
      // Truncate very long files to first 2000 chars
      const excerpt = kbFile.content.length > 2000
        ? kbFile.content.slice(0, 2000) + '\n\n_[truncated — see full file for more]_'
        : kbFile.content;
      lines.push(excerpt);
      lines.push('');
    }
  }

  // ── Skill context ──────────────────────────────────────────────────────────
  lines.push('## Skills loaded for this investigation');
  lines.push('');
  lines.push('Read these skill files before investigating:');
  lines.push('');
  for (const skill of skillSelection) {
    lines.push(`### ${skill.name}`);
    lines.push('');
    lines.push(`**File:** \`${skill.filePath}\``);
    lines.push(`**Selected because:** ${skill.reason}`);
    lines.push(`**Description:** ${skill.description}`);
    lines.push('');
  }
  if (excludedSkills.length > 0) {
    lines.push(`_Skills not loaded (not relevant): ${excludedSkills.join(', ')}_`);
    lines.push('');
  }
  lines.push(`_Selection rationale: ${selectionRationale}_`);
  lines.push('');

  // ── Investigation template ─────────────────────────────────────────────────
  lines.push('## Investigation (complete this section)');
  lines.push('');
  lines.push('> Agent: investigate the codebase and evidence, then fill in the sections below.');
  lines.push('> Refer to the skill files above for investigation methodology.');
  lines.push('');

  lines.push('### What is the root cause?');
  lines.push('');
  lines.push('_To be determined._');
  lines.push('');

  lines.push('### Which files/components are responsible?');
  lines.push('');
  lines.push('_To be determined._');
  lines.push('');

  lines.push('### How was this reproduced?');
  lines.push('');
  lines.push('_To be determined._');
  lines.push('');

  lines.push('### What is the proposed solution?');
  lines.push('');
  lines.push('_To be determined._');
  lines.push('');

  lines.push('### Alternative approaches considered');
  lines.push('');
  lines.push('_To be determined._');
  lines.push('');

  lines.push('### Confidence in root cause');
  lines.push('');
  lines.push('_Low / Medium / High — explain why_');
  lines.push('');

  lines.push('### Blast radius');
  lines.push('');
  lines.push('_What else could be affected by this change?_');
  lines.push('');

  lines.push('### Tests that should pass after the fix');
  lines.push('');
  lines.push('_To be determined._');
  lines.push('');

  lines.push('### Remaining open questions');
  lines.push('');
  lines.push('- [ ] _None identified yet_');
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('_Generated by `aethra investigate`. Fill in the investigation sections above,_');
  lines.push('_then run `aethra plan-fix` to create an approved implementation plan._');

  return lines.join('\n');
}
