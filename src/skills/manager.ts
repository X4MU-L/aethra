/**
 * Skills management system.
 * Validates, lists, and registers reusable agent skills.
 * Skills are versioned Markdown files with YAML frontmatter.
 */

import path from 'path';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import os from 'os';
import { expandPath, listDir, pathExists, writeFile, ensureDir } from '../engine/fs.js';
import { SkillMetadataSchema } from '../core/schemas.js';
import type { SkillMetadata } from '../core/schemas.js';
import { logger } from '../core/logger.js';

const AETHRA_SKILLS_DIR = path.join(os.homedir(), '.aethra', 'skills');
const CLAUDE_SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');

export interface Skill {
  metadata: SkillMetadata;
  content: string;
  filePath: string;
  source: 'global' | 'project' | 'client';
}

export interface SkillValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  skill?: Skill;
}

/** Parse a skill file (YAML frontmatter + Markdown body). */
export function parseSkillFile(content: string, filePath: string): Skill | null {
  const fmMatch = content.match(/^---\n([\s\S]+?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return null;

  const [, frontmatter = '', body = ''] = fmMatch;

  try {
    const parsed = yaml.load(frontmatter) as Record<string, unknown>;
    const now = new Date().toISOString();
    const metadata = SkillMetadataSchema.parse({
      createdAt: now,
      updatedAt: now,
      ...parsed,
    });
    return {
      metadata,
      content: body.trim(),
      filePath,
      source: 'global',
    };
  } catch (err) {
    logger.warn(`Could not parse skill at ${filePath}: ${(err as Error).message}`);
    return null;
  }
}

/** Validate a skill file. */
export function validateSkill(content: string, filePath: string): SkillValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const skill = parseSkillFile(content, filePath);
  if (!skill) {
    errors.push('Could not parse YAML frontmatter. Check that the file starts with ---');
    return { valid: false, errors, warnings };
  }

  if (skill.content.length < 50) {
    warnings.push('Skill body is very short — consider adding more detailed instructions');
  }
  if (!skill.metadata.whenToInvoke) {
    warnings.push('No whenToInvoke specified — agents may not know when to use this skill');
  }
  if (skill.metadata.requiredTools.length === 0) {
    warnings.push('No requiredTools specified');
  }

  return { valid: errors.length === 0, errors, warnings, skill };
}

/** List all skills from a directory. */
export async function listSkillsFromDir(
  dir: string,
  source: Skill['source'],
): Promise<Skill[]> {
  const resolved = expandPath(dir);
  if (!(await pathExists(resolved))) return [];

  const entries = await listDir(resolved);
  const skills: Skill[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const fullPath = path.join(resolved, entry);
    try {
      const content = await fs.readFile(fullPath, 'utf8');
      const skill = parseSkillFile(content, fullPath);
      if (skill) {
        skill.source = source;
        skills.push(skill);
      }
    } catch {
      logger.warn(`Could not read skill: ${fullPath}`);
    }
  }

  return skills;
}

/** List all skills from global and project locations. */
export async function listAllSkills(
  projectSkillsDir?: string,
  clientSkillsDir?: string,
): Promise<Skill[]> {
  const [globalSkills, projectSkills, clientSkills] = await Promise.all([
    listSkillsFromDir(AETHRA_SKILLS_DIR, 'global'),
    projectSkillsDir ? listSkillsFromDir(projectSkillsDir, 'project') : Promise.resolve([]),
    clientSkillsDir ? listSkillsFromDir(clientSkillsDir, 'client') : Promise.resolve([]),
  ]);

  return [...globalSkills, ...projectSkills, ...clientSkills];
}

/** Write a skill to a directory. */
export async function writeSkill(
  skill: Pick<Skill, 'metadata' | 'content'>,
  dir: string,
): Promise<string> {
  await ensureDir(expandPath(dir));
  const filename = `${skill.metadata.name}.md`;
  const filePath = path.join(expandPath(dir), filename);

  const frontmatter = yaml.dump({
    name: skill.metadata.name,
    version: skill.metadata.version,
    description: skill.metadata.description,
    status: skill.metadata.status,
    category: skill.metadata.category,
    whenToInvoke: skill.metadata.whenToInvoke,
    requiredInputs: skill.metadata.requiredInputs,
    preconditions: skill.metadata.preconditions,
    requiredTools: skill.metadata.requiredTools,
    requiredPermissions: skill.metadata.requiredPermissions,
    expectedOutputs: skill.metadata.expectedOutputs,
    safetyConstraints: skill.metadata.safetyConstraints,
    platforms: skill.metadata.platforms,
    examples: skill.metadata.examples,
    createdAt: skill.metadata.createdAt,
    updatedAt: skill.metadata.updatedAt,
  });

  const fileContent = `---\n${frontmatter}---\n\n${skill.content}\n`;
  await writeFile(filePath, fileContent);
  logger.success(`Skill written: ${filePath}`);
  return filePath;
}

const AETHRA_SKILL_PREFIX = 'aethra--';

/** Copy Aethra skills to Claude Code's skills directory with namespace prefix. */
export async function syncSkillsToClaudeCode(
  sourceDir: string = AETHRA_SKILLS_DIR,
): Promise<void> {
  const resolved = expandPath(sourceDir);
  if (!(await pathExists(resolved))) {
    logger.warn(`Skills source directory not found: ${resolved}`);
    return;
  }

  await ensureDir(CLAUDE_SKILLS_DIR);
  const skills = await listSkillsFromDir(resolved, 'global');

  for (const skill of skills) {
    if (skill.metadata.status === 'deprecated') continue;
    const baseName = path.basename(skill.filePath);
    const destFilename = `${AETHRA_SKILL_PREFIX}${baseName}`;
    const destPath = path.join(CLAUDE_SKILLS_DIR, destFilename);

    // Check if user has their own skill with the same base name (without prefix)
    const userFilePath = path.join(CLAUDE_SKILLS_DIR, baseName);
    if (await pathExists(userFilePath)) {
      const content = await fs.readFile(userFilePath, 'utf8');
      if (!content.includes('adapted_by: Aethra') && !content.includes('source: Aethra')) {
        logger.warn(
          `User skill "${baseName}" exists — Aethra version saved as "${destFilename}"`,
        );
      }
    }

    await fs.copy(skill.filePath, destPath, { overwrite: true });
    logger.success(`Synced skill to Claude Code: ${destFilename}`);
  }
}

/** Install the built-in Aethra skills to ~/.aethra/skills/. */
export async function installBuiltinSkills(
  builtinSkillsDir: string,
  overwrite = false,
): Promise<{ installed: number; skipped: number }> {
  await ensureDir(AETHRA_SKILLS_DIR);
  const skills = await listSkillsFromDir(builtinSkillsDir, 'global');
  let installed = 0;
  let skipped = 0;

  for (const skill of skills) {
    const destPath = path.join(AETHRA_SKILLS_DIR, path.basename(skill.filePath));
    const exists = await pathExists(destPath);

    if (!exists || overwrite) {
      await fs.copy(skill.filePath, destPath, { overwrite: true });
      logger.success(`Installed skill: ${skill.metadata.name}`);
      installed++;
    } else {
      skipped++;
    }
  }

  return { installed, skipped };
}
