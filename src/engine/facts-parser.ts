/**
 * Client facts parser.
 * Reads a directory of markdown, text, and YAML files to extract structured
 * client facts. Input is treated as untrusted user-supplied content.
 */

import path from 'path';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import type { ClientFacts } from '../core/schemas.js';
import { expandPath, listDir } from '../engine/fs.js';
import { logger } from '../core/logger.js';

interface ParseResult {
  facts: Partial<ClientFacts>;
  warnings: string[];
  sourceFiles: string[];
}

/** Parse a facts directory and extract structured client facts. */
export async function parseFactsDirectory(factsDir: string): Promise<ParseResult> {
  const resolved = expandPath(factsDir);
  const warnings: string[] = [];
  const sourceFiles: string[] = [];
  const accumulated: Partial<ClientFacts> = {
    objectives: [],
    knownUrls: [],
    locations: [],
    services: [],
    knownIntegrations: [],
    constraints: [],
    desiredOutcomes: [],
    openQuestions: [],
    sourceFiles: [],
  };

  if (!(await fs.pathExists(resolved))) {
    warnings.push(`Facts directory not found: ${resolved}`);
    return { facts: accumulated, warnings, sourceFiles };
  }

  const entries = await listDir(resolved);
  logger.info(`Parsing facts from ${entries.length} entries in ${resolved}`);

  for (const entry of entries) {
    const fullPath = path.join(resolved, entry);
    const stat = await fs.stat(fullPath);

    if (stat.isDirectory()) {
      // Recurse into reference-material/ and notes/ subdirs
      if (['reference-material', 'notes', 'assets'].includes(entry)) {
        const subEntries = await listDir(fullPath);
        for (const sub of subEntries) {
          const subPath = path.join(fullPath, sub);
          await parseFile(subPath, accumulated, warnings, sourceFiles);
        }
      }
      continue;
    }

    await parseFile(fullPath, accumulated, warnings, sourceFiles);
  }

  return { facts: accumulated, warnings, sourceFiles };
}

async function parseFile(
  filePath: string,
  accumulated: Partial<ClientFacts>,
  warnings: string[],
  sourceFiles: string[],
): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath, ext).toLowerCase();

  try {
    const content = await fs.readFile(filePath, 'utf8');
    sourceFiles.push(filePath);

    if (ext === '.yaml' || ext === '.yml') {
      parseYamlFacts(content, accumulated, filePath, warnings);
    } else if (ext === '.md' || ext === '.txt') {
      parseTextFacts(content, name, accumulated, filePath);
    } else if (ext === '.json') {
      parseJsonFacts(content, accumulated, filePath, warnings);
    }
    // Skip binary files, images, etc.
  } catch (err) {
    warnings.push(`Could not parse ${filePath}: ${(err as Error).message}`);
  }
}

function parseYamlFacts(
  content: string,
  accumulated: Partial<ClientFacts>,
  filePath: string,
  warnings: string[],
): void {
  try {
    const parsed = yaml.load(content) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) return;

    mergeStringField(parsed, accumulated, 'name');
    mergeStringField(parsed, accumulated, 'slug');
    mergeStringField(parsed, accumulated, 'description');
    mergeStringField(parsed, accumulated, 'targetCustomers', 'target_customers');
    mergeStringField(parsed, accumulated, 'primaryUrl', 'primary_url', 'website', 'url');
    mergeStringField(parsed, accumulated, 'knownPlatform', 'platform', 'known_platform');
    mergeStringField(parsed, accumulated, 'confidentialityNotes', 'confidentiality');

    mergeArrayField(parsed, accumulated, 'objectives');
    mergeArrayField(parsed, accumulated, 'knownUrls', 'urls', 'known_urls');
    mergeArrayField(parsed, accumulated, 'locations');
    mergeArrayField(parsed, accumulated, 'services');
    mergeArrayField(parsed, accumulated, 'knownIntegrations', 'integrations', 'known_integrations');
    mergeArrayField(parsed, accumulated, 'constraints');
    mergeArrayField(parsed, accumulated, 'desiredOutcomes', 'outcomes', 'desired_outcomes');
    mergeArrayField(parsed, accumulated, 'openQuestions', 'questions', 'open_questions');
  } catch (err) {
    warnings.push(`YAML parse error in ${filePath}: ${(err as Error).message}`);
  }
}

function parseJsonFacts(
  content: string,
  accumulated: Partial<ClientFacts>,
  filePath: string,
  warnings: string[],
): void {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    parseYamlFacts(yaml.dump(parsed), accumulated, filePath, warnings);
  } catch {
    warnings.push(`JSON parse error in ${filePath}`);
  }
}

function parseTextFacts(
  content: string,
  filename: string,
  accumulated: Partial<ClientFacts>,
  _filePath: string,
): void {
  // Extract URLs from content
  const urlPattern = /https?:\/\/[^\s\)>"',]+/g;
  const urls = content.match(urlPattern) ?? [];
  for (const url of urls) {
    const cleanUrl = url.replace(/[.,;:!?]$/, '');
    if (!accumulated.knownUrls!.includes(cleanUrl)) {
      accumulated.knownUrls!.push(cleanUrl);
    }
  }

  // If this is brief.md, treat it as the primary description source
  if (filename === 'brief') {
    // Extract the first H1 — strip common suffixes like "— Client Brief", "— Brief", "— Requirements"
    const h1 = content.match(/^#\s+(.+)/m);
    if (h1 && !accumulated.name) {
      let clientName = h1[1].trim();
      // Strip common brief/document suffixes
      clientName = clientName.replace(/\s*[-—–]\s*(client\s+)?brief\s*$/i, '').trim();
      clientName = clientName.replace(/\s*[-—–]\s*requirements\s*$/i, '').trim();
      clientName = clientName.replace(/\s*[-—–]\s*project\s*.*$/i, '').trim();
      accumulated.name = clientName;
    }

    // Look for a description section
    const descMatch = content.match(/##\s*(?:description|about|overview)\s*\n+([\s\S]+?)(?:\n##|$)/i);
    if (descMatch && !accumulated.description) {
      accumulated.description = descMatch[1].trim().slice(0, 1500);
    }
  }

  // Extract business objectives only from brief.md (requirements.md has task-specific goals)
  if (filename === 'brief') {
    const objectives = extractListItems(content, /##?\s*(?:objectives?|goals?|aims?)/i);
    for (const obj of objectives) {
      // Case-insensitive dedup
      const lower = obj.toLowerCase();
      if (!accumulated.objectives!.some((o) => o.toLowerCase() === lower)) {
        accumulated.objectives!.push(obj);
      }
    }
  }

  // Extract desired outcomes from brief and requirements
  if (filename === 'requirements' || filename === 'brief') {
    const outcomes = extractListItems(content, /##?\s*(?:outcomes?|desired outcomes?|expected)/i);
    for (const out of outcomes) {
      const lower = out.toLowerCase();
      if (!accumulated.desiredOutcomes!.some((o) => o.toLowerCase() === lower)) {
        accumulated.desiredOutcomes!.push(out);
      }
    }
  }

  if (filename === 'known-urls' || filename === 'urls') {
    // Each line could be a URL
    const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.startsWith('http')) {
        const clean = line.replace(/[.,;:!?]$/, '');
        if (!accumulated.knownUrls!.includes(clean)) accumulated.knownUrls!.push(clean);
      }
    }
  }
}

function extractListItems(content: string, sectionPattern: RegExp): string[] {
  const sectionMatch = content.match(new RegExp(`${sectionPattern.source}\\s*\\n([\\s\\S]+?)(?:\\n##|$)`, 'i'));
  if (!sectionMatch) return [];
  const section = sectionMatch[1];
  return section
    .split('\n')
    .map((l) => l.replace(/^[-*•]\s*/, '').trim())
    .filter((l) => l.length > 5 && l.length < 200);
}

function mergeStringField(
  parsed: Record<string, unknown>,
  accumulated: Partial<ClientFacts>,
  field: keyof ClientFacts,
  ...aliases: string[]
): void {
  const keys = [field, ...aliases];
  for (const key of keys) {
    const val = parsed[key];
    if (typeof val === 'string' && val.trim()) {
      if (!accumulated[field]) {
        (accumulated as Record<string, unknown>)[field] = val.trim();
      }
      return;
    }
  }
}

function mergeArrayField(
  parsed: Record<string, unknown>,
  accumulated: Partial<ClientFacts>,
  field: keyof ClientFacts,
  ...aliases: string[]
): void {
  const keys = [field, ...aliases];
  for (const key of keys) {
    const val = parsed[key];
    if (Array.isArray(val)) {
      const existing = (accumulated[field] as string[] | undefined) ?? [];
      const merged = [...existing];
      for (const item of val) {
        if (typeof item === 'string') {
          // Case-insensitive deduplication
          const lower = item.toLowerCase();
          if (!merged.some((m) => m.toLowerCase() === lower)) {
            merged.push(item);
          }
        }
      }
      (accumulated as Record<string, unknown>)[field] = merged;
      return;
    }
  }
}

/**
 * Derive a slug from a client name.
 * e.g. "EkeBoss Restaurant" → "ekeboss-restaurant"
 */
export function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/**
 * Derive the primary URL from a list of known URLs.
 * Prefers www/apex domain, avoids social profiles and subpages.
 */
export function derivePrimaryUrl(urls: string[]): string | undefined {
  const candidates = urls.filter((u) => {
    try {
      const parsed = new URL(u);
      // Prefer apex/www domains without deep paths
      return parsed.pathname.length <= 2;
    } catch {
      return false;
    }
  });
  return candidates[0];
}

/**
 * Validate and complete parsed facts.
 * Returns the validated facts and a list of remaining unknowns.
 */
export function validateFacts(
  partial: Partial<ClientFacts>,
): { valid: boolean; facts: Partial<ClientFacts>; unknowns: string[] } {
  const unknowns: string[] = [];

  if (!partial.name) unknowns.push('client name');
  if (!partial.primaryUrl && (!partial.knownUrls || partial.knownUrls.length === 0)) {
    unknowns.push('website URL');
  }
  if (!partial.description) unknowns.push('business description');

  // Try to auto-derive slug
  if (!partial.slug && partial.name) {
    partial.slug = deriveSlug(partial.name);
  }

  // Try to derive primary URL
  if (!partial.primaryUrl && partial.knownUrls && partial.knownUrls.length > 0) {
    partial.primaryUrl = derivePrimaryUrl(partial.knownUrls);
  }

  const valid = unknowns.length === 0 || (!!partial.name && !!partial.slug);
  return { valid, facts: partial, unknowns };
}
