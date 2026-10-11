/**
 * Context selection engine.
 * Determines which skills are relevant for a given task based on:
 * - Detected platform
 * - Task description keywords
 * - Workflow stage
 * - Required tool availability
 *
 * This is Level 2 context loading: workflow-specific, not exhaustive.
 */

import path from "path";
import os from "os";
import { pathExists } from "./fs.js";
import { listSkillsFromDir } from "../skills/manager.js";
import type {
  PlatformType,
  TaskClassificationResult,
} from "../core/schemas.js";

const AETHRA_SKILLS_DIR = path.join(os.homedir(), ".aethra", "skills");

export interface SkillSelection {
  name: string;
  filePath: string;
  description: string;
  reason: string; // why this skill was selected
}

export interface ContextSelectionResult {
  selectedSkills: SkillSelection[];
  excluded: string[]; // skill names excluded and why
  selectionRationale: string;
}

/**
 * Select 2-4 relevant skills for a given task.
 * Returns skills sorted by priority (most relevant first).
 */
export async function selectSkillsForTask(
  taskDescription: string,
  platform: PlatformType | undefined,
  workflowStage: "investigate" | "plan" | "implement" | "verify",
  clientSkillsDir?: string,
): Promise<ContextSelectionResult> {
  // Collect all available skills
  const skillDirs: string[] = [AETHRA_SKILLS_DIR];
  if (clientSkillsDir) skillDirs.push(clientSkillsDir);

  const allSkills: Array<{
    name: string;
    filePath: string;
    description: string;
    category: string;
    platforms?: string[];
  }> = [];
  for (const dir of skillDirs) {
    if (!(await pathExists(dir))) continue;
    const loaded = await listSkillsFromDir(dir, "global").catch(() => []);
    for (const s of loaded) {
      if (s.metadata.status === "deprecated") continue;
      allSkills.push({
        name: s.metadata.name,
        filePath: s.filePath,
        description: s.metadata.description,
        category: s.metadata.category,
        platforms: s.metadata.platforms?.map(String),
      });
    }
  }

  const taskLower = taskDescription.toLowerCase();
  const selected: SkillSelection[] = [];
  const excluded: string[] = [];

  // Priority 1: Platform-specific skill (if platform is known and a skill exists for it)
  const platformSkillMap: Partial<Record<PlatformType, string>> = {
    wordpress: "wordpress-local-development",
    woocommerce: "wordpress-local-development",
    shopify: "shopify-development",
  };
  const platformSkillName = platform ? platformSkillMap[platform] : undefined;

  for (const skill of allSkills) {
    if (skill.name === platformSkillName) {
      selected.push({
        name: skill.name,
        filePath: skill.filePath,
        description: skill.description,
        reason: `Platform-specific: detected platform is ${platform}`,
      });
    }
  }

  // Priority 2: Stage-appropriate core skills
  // engineering-principles is always included — it applies to every stage
  const stageSkillNames: Record<string, string[]> = {
    investigate: ["engineering-principles", "website-audit", "fix-planning"],
    plan: ["engineering-principles", "fix-planning", "website-audit"],
    implement: [
      "engineering-principles",
      "git-safe-implementation",
      "fix-planning",
    ],
    verify: [
      "engineering-principles",
      "website-audit",
      "technical-documentation",
    ],
  };
  const wantedForStage = stageSkillNames[workflowStage] ?? [
    "website-audit",
    "fix-planning",
  ];

  for (const skillName of wantedForStage) {
    if (selected.some((s) => s.name === skillName)) continue; // already added
    const skill = allSkills.find((s) => s.name === skillName);
    if (skill) {
      selected.push({
        name: skill.name,
        filePath: skill.filePath,
        description: skill.description,
        reason: `Standard for ${workflowStage} stage`,
      });
    }
  }

  // Priority 3: Task-keyword matching (add at most one additional skill)
  const keywordMap: Array<{
    keywords: string[];
    skillName: string;
    reason: string;
  }> = [
    {
      keywords: ["git", "commit", "branch", "merge", "diff"],
      skillName: "git-safe-implementation",
      reason: "Task involves Git operations",
    },
    {
      keywords: ["document", "docs", "readme", "changelog", "spec"],
      skillName: "technical-documentation",
      reason: "Task involves documentation",
    },
    {
      keywords: [
        "feedback",
        "visual",
        "annotation",
        "design-review",
        "agentation",
        "toolbar",
      ],
      skillName: "visual-feedback-agentation",
      reason: "Task involves visual feedback or design review",
    },
    {
      keywords: [
        "diagram",
        "illustrat",
        "architecture diagram",
        "flowchart",
        "svg",
        "explainer",
      ],
      skillName: "technical-illustration-anatomy",
      reason: "Task involves technical illustration",
    },
  ];

  for (const { keywords, skillName, reason } of keywordMap) {
    if (selected.some((s) => s.name === skillName)) continue;
    if (selected.length >= 5) break; // cap at 5 skills (engineering-principles + 4 specific)
    if (keywords.some((kw) => taskLower.includes(kw))) {
      const skill = allSkills.find((s) => s.name === skillName);
      if (skill) {
        selected.push({
          name: skill.name,
          filePath: skill.filePath,
          description: skill.description,
          reason,
        });
      }
    }
  }

  // Record excluded skills
  for (const skill of allSkills) {
    if (!selected.some((s) => s.name === skill.name)) {
      excluded.push(skill.name);
    }
  }

  const rationale = [
    `Platform: ${platform ?? "unknown"}`,
    `Stage: ${workflowStage}`,
    `Selected: ${selected.map((s) => s.name).join(", ") || "none"}`,
    `Excluded (not relevant for this task): ${excluded.join(", ") || "none"}`,
  ].join(" | ");

  return { selectedSkills: selected, excluded, selectionRationale: rationale };
}

/**
 * Enhanced skill selection with task classification and capability awareness.
 * Extends the base selectSkillsForTask with additional tiers:
 * - Tier 2: design-specific skills when task is classified as design-exploration
 * - Tier 3: capability filtering (exclude skills requiring unavailable capabilities)
 *
 * The existing selectSkillsForTask is preserved unchanged for backward compatibility.
 */
export async function selectSkillsForTaskEnhanced(
  taskDescription: string,
  platform: PlatformType | undefined,
  workflowStage: "investigate" | "plan" | "implement" | "verify",
  clientSkillsDir?: string,
  options?: {
    taskClassification?: TaskClassificationResult;
  },
): Promise<ContextSelectionResult> {
  // Tier 1: standard deterministic selection
  const base = await selectSkillsForTask(
    taskDescription,
    platform,
    workflowStage,
    clientSkillsDir,
  );

  if (!options?.taskClassification) {
    return base;
  }

  const { taskClassification } = options;
  const selected = [...base.selectedSkills];
  const excluded = [...base.excluded];

  // Tier 2: add design skills when task requires design workflow
  if (taskClassification.requiresDesignWorkflow) {
    const designSkills = ["ui-design-discovery", "ui-design-critique"];

    // Collect available skills to find design ones
    const skillDirs: string[] = [AETHRA_SKILLS_DIR];
    if (clientSkillsDir) skillDirs.push(clientSkillsDir);

    for (const dir of skillDirs) {
      if (!(await pathExists(dir))) continue;
      const loaded = await listSkillsFromDir(dir, "global").catch(() => []);
      for (const s of loaded) {
        if (!designSkills.includes(s.metadata.name)) continue;
        if (selected.some((sel) => sel.name === s.metadata.name)) continue;
        if (selected.length >= 6) break; // slightly higher cap for design tasks

        selected.push({
          name: s.metadata.name,
          filePath: s.filePath,
          description: s.metadata.description,
          reason: `Design workflow: task classified as ${taskClassification.classification}`,
        });

        // Remove from excluded if it was there
        const exIdx = excluded.indexOf(s.metadata.name);
        if (exIdx >= 0) excluded.splice(exIdx, 1);
      }
    }
  }

  const rationale = [
    `Platform: ${platform ?? "unknown"}`,
    `Stage: ${workflowStage}`,
    `Classification: ${taskClassification.classification} (${Math.round(taskClassification.confidence * 100)}%)`,
    `Selected: ${selected.map((s) => s.name).join(", ") || "none"}`,
    `Excluded: ${excluded.join(", ") || "none"}`,
  ].join(" | ");

  return { selectedSkills: selected, excluded, selectionRationale: rationale };
}
