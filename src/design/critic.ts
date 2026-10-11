/**
 * Design critic module for independent visual evaluation.
 * Evaluates design output against a brief using structured critique
 * dimensions, producing actionable scores and suggestions.
 *
 * Currently provides a stub implementation ready for multimodal
 * model integration when an evaluation provider is available.
 */

import crypto from "crypto";
import path from "path";
import { glob } from "glob";
import type { CritiqueResult, DesignBrief } from "../core/schemas.js";
import { writeJson, readJson, ensureDir, pathExists } from "../engine/fs.js";
import { logger } from "../core/logger.js";

const CRITIQUE_DIMENSIONS = [
  "visual-hierarchy",
  "typographic-clarity",
  "color-consistency",
  "layout-balance",
  "responsive-adaptation",
  "content-readability",
  "interaction-clarity",
  "distinctiveness",
  "accessibility-visual",
  "brand-alignment",
] as const;

export function createCritiquePrompt(
  screenshotPaths: string[],
  designBrief: DesignBrief | null,
  taskDescription: string,
): string {
  // Build a prompt for visual evaluation
  // IMPORTANT: Does NOT include implementation code -- fresh context only
  const sections: string[] = [
    "# Visual Design Critique",
    "",
    "## Task",
    taskDescription,
    "",
  ];

  if (designBrief) {
    sections.push(
      "## Design Brief",
      `- Aesthetic: ${designBrief.aesthetic}`,
      `- Composition: ${designBrief.composition}`,
      `- Hierarchy: ${designBrief.hierarchy}`,
      `- Typography: ${designBrief.typography}`,
      `- Colors: ${designBrief.colors.join(", ")}`,
      `- Interaction: ${designBrief.interactionCharacter}`,
      "",
      "### Anti-patterns to watch for",
      ...designBrief.antiPatterns.map((ap) => `- ${ap}`),
      "",
    );
  }

  sections.push(
    "## Screenshots to evaluate",
    ...screenshotPaths.map((p, i) => `${i + 1}. ${p}`),
    "",
    "## Evaluation dimensions",
    ...CRITIQUE_DIMENSIONS.map((d) => `- ${d}`),
    "",
    "## Instructions",
    "Evaluate each dimension on a scale of 0-10.",
    "For each dimension, provide:",
    "1. A score (0-10)",
    "2. A specific observation about what you see",
    "3. A concrete suggestion for improvement",
    "",
    "Focus on the visible result, not implementation approach.",
    'Be specific — "improve spacing" is not actionable; "increase padding between hero text and CTA button to at least 24px" is.',
  );

  return sections.join("\n");
}

export async function evaluateDesign(input: {
  screenshotPaths: string[];
  designBrief?: DesignBrief;
  taskDescription: string;
}): Promise<CritiqueResult> {
  // Stub: generates the evaluation prompt but does not call a model.
  // Returns reviewStatus: "pending" so consumers know this is unevaluated.
  logger.info(
    "Design critique: manual visual review required (model integration pending)",
  );

  const prompt = createCritiquePrompt(
    input.screenshotPaths,
    input.designBrief ?? null,
    input.taskDescription,
  );

  const now = new Date().toISOString();
  return {
    id: crypto.randomBytes(8).toString("hex"),
    taskId: undefined,
    briefId: input.designBrief?.id,
    screenshotPaths: input.screenshotPaths,
    scores: CRITIQUE_DIMENSIONS.map((dim) => ({
      dimension: dim,
      score: 0,
      observation: "Not yet evaluated — pending review",
      suggestion: "Evaluate this dimension during design review",
    })),
    overallScore: 0,
    summary:
      "Design critique pending review. Prompt generated for external model evaluation.",
    strengths: [],
    improvements: [],
    accessibilityNotes: [],
    reviewStatus: "pending",
    critiquePrompt: prompt,
    createdAt: now,
  };
}

export async function saveCritique(
  workspacePath: string,
  critique: CritiqueResult,
): Promise<string> {
  const dir = path.join(workspacePath, "evidence", "design-critiques");
  await ensureDir(dir);
  const fp = path.join(dir, `critique-${critique.id}.json`);
  await writeJson(fp, critique);
  logger.debug(`Critique saved: ${fp}`);
  return fp;
}

/** Load the latest critique for a task. Returns null if none found. */
export async function loadCritique(
  workspacePath: string,
  taskId: string,
): Promise<CritiqueResult | null> {
  const dir = path.join(workspacePath, "evidence", "design-critiques");
  if (!(await pathExists(dir))) return null;

  const files = await glob("critique-*.json", { cwd: dir });
  const matches: CritiqueResult[] = [];

  for (const file of files) {
    try {
      const critique = await readJson<CritiqueResult>(path.join(dir, file));
      if (critique.taskId === taskId) {
        matches.push(critique);
      }
    } catch {
      // Skip malformed files
    }
  }

  if (matches.length === 0) return null;

  // Sort newest first by createdAt
  matches.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return matches[0]!;
}
