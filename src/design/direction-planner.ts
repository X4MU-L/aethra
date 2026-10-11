/**
 * Design direction planner.
 * Generates diverse design directions using orthogonal axis variation
 * with Hamming-distance maximization to ensure each direction is
 * meaningfully different from the others.
 */

import crypto from "crypto";
import path from "path";
import type { DesignDirection } from "../core/schemas.js";
import { writeJson, readJson, ensureDir, pathExists } from "../engine/fs.js";

// ─── Design axes ────────────────────────────────────────────────────────────

const DESIGN_AXES: Record<string, string[]> = {
  "layout-density": [
    "spacious-editorial",
    "balanced-standard",
    "compact-information-dense",
  ],
  "typography-character": [
    "geometric-modern",
    "humanist-warm",
    "serif-authoritative",
    "monospace-technical",
  ],
  "color-temperature": [
    "cool-professional",
    "warm-approachable",
    "neutral-minimal",
    "vibrant-energetic",
  ],
  "hierarchy-strategy": [
    "hero-dominant",
    "grid-equal-weight",
    "progressive-reveal",
    "sidebar-content",
  ],
  "interaction-weight": [
    "minimal-static",
    "subtle-transitions",
    "rich-animated",
    "scroll-driven",
  ],
  "imagery-role": [
    "photography-led",
    "illustration-led",
    "icon-led",
    "typography-only",
  ],
};

const AXIS_DESCRIPTIONS: Record<string, Record<string, string>> = {
  "layout-density": {
    "spacious-editorial": "Generous whitespace, magazine-like composition",
    "balanced-standard": "Conventional spacing, familiar web patterns",
    "compact-information-dense": "Maximized content density, dashboard-like",
  },
  "typography-character": {
    "geometric-modern":
      "Clean, precise letterforms with mathematical proportion",
    "humanist-warm": "Organic, friendly typefaces with calligraphic roots",
    "serif-authoritative":
      "Traditional serifs conveying credibility and heritage",
    "monospace-technical":
      "Fixed-width type suggesting precision and technical depth",
  },
  "color-temperature": {
    "cool-professional":
      "Blues, grays, and muted tones evoking trust and competence",
    "warm-approachable": "Earthy tones and warm hues creating a welcoming feel",
    "neutral-minimal": "Restrained palette relying on contrast and typography",
    "vibrant-energetic":
      "Bold, saturated colors conveying dynamism and confidence",
  },
  "hierarchy-strategy": {
    "hero-dominant": "Large hero element anchors the page, clear focal point",
    "grid-equal-weight": "Evenly distributed content in a structured grid",
    "progressive-reveal":
      "Content unfolds in layers, guiding the viewer step by step",
    "sidebar-content":
      "Two-column layout with persistent navigation or context",
  },
  "interaction-weight": {
    "minimal-static":
      "No animations, instant state changes, pure content focus",
    "subtle-transitions": "Gentle fades and slides that ease navigation",
    "rich-animated":
      "Purposeful motion design reinforcing spatial relationships",
    "scroll-driven": "Scroll-triggered animations and parallax storytelling",
  },
  "imagery-role": {
    "photography-led":
      "Full-bleed or prominent photography driving visual identity",
    "illustration-led":
      "Custom illustrations adding personality and uniqueness",
    "icon-led": "Iconographic system providing clarity and visual rhythm",
    "typography-only": "Type as primary visual element, minimal imagery",
  },
};

const AXIS_NAMES = Object.keys(DESIGN_AXES);

// ─── PRNG (mulberry32) ─────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Core functions ─────────────────────────────────────────────────────────

/** Count positions where two axis-position arrays differ. */
export function hammingDistance(a: string[], b: string[]): number {
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) dist++;
  }
  return dist;
}

/** Synthesize a human-readable name from dominant axis positions. */
function synthesizeName(positions: string[]): string {
  // Pick the two most characterful axes for the name
  const parts = [
    positions[1]?.split("-")[0] ?? "balanced", // typography-character first word
    positions[0]?.split("-")[0] ?? "standard", // layout-density first word
    positions[2]?.split("-")[0] ?? "neutral", // color-temperature first word
  ];
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

/** Generate all possible axis combinations as position arrays. */
function allCombinations(): string[][] {
  const axisValues = AXIS_NAMES.map((name) => DESIGN_AXES[name]);
  const results: string[][] = [];

  function recurse(depth: number, current: string[]): void {
    if (depth === axisValues.length) {
      results.push([...current]);
      return;
    }
    for (const val of axisValues[depth]) {
      current.push(val);
      recurse(depth + 1, current);
      current.pop();
    }
  }

  recurse(0, []);
  return results;
}

/**
 * Generate `count` maximally different design directions.
 *
 * Algorithm: start with a random direction, then for each subsequent
 * direction pick the combination that maximizes the minimum Hamming
 * distance from all previously selected directions.
 */
export function generateDesignDirections(
  count: number = 4,
  seed?: number,
): DesignDirection[] {
  const safeCount =
    typeof count === "number" && !isNaN(count) && count > 0
      ? Math.max(1, Math.min(Math.floor(count), 50))
      : 4;
  const safeSeed =
    typeof seed === "number" && !isNaN(seed) ? seed : undefined;

  const rng = mulberry32(safeSeed ?? Date.now());
  const combos = allCombinations();

  // Pick the first direction randomly
  const firstIdx = Math.floor(rng() * combos.length);
  const selected: string[][] = [combos[firstIdx]!];

  // Greedily select subsequent directions that maximize minimum Hamming distance
  for (let i = 1; i < safeCount && i < combos.length; i++) {
    let bestCombo: string[] | undefined;
    let bestMinDist = -1;

    for (const combo of combos) {
      // Skip if already selected
      if (selected.some((s) => hammingDistance(s, combo) === 0)) continue;

      const minDist = Math.min(
        ...selected.map((s) => hammingDistance(s, combo)),
      );
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        bestCombo = combo;
      }
    }

    if (bestCombo) {
      selected.push(bestCombo);
    }
  }

  // Convert to DesignDirection objects
  return selected.map((positions) => {
    const id = crypto.randomBytes(8).toString("hex");
    const axes = AXIS_NAMES.map((axisName, i) => ({
      axis: axisName,
      position: positions[i]!,
      description: AXIS_DESCRIPTIONS[axisName]?.[positions[i]!] ?? positions[i]!,
    }));

    return {
      id,
      name: synthesizeName(positions),
      axes,
      rationale: `Direction combining ${positions.slice(0, 3).join(", ")} for a distinctive visual approach.`,
    };
  });
}

/**
 * Plan design directions enriched with task-specific context.
 *
 * Generates directions, enriches each with rationale based on client
 * facts, and filters out directions that conflict with known constraints.
 */
export function planDesignDirections(
  taskDescription: string,
  clientFacts?: { constraints?: string[]; desiredOutcomes?: string[] },
  count?: number,
  seed?: number,
): DesignDirection[] {
  const directions = generateDesignDirections(count ?? 4, seed);
  const constraints = clientFacts?.constraints ?? [];
  const outcomes = clientFacts?.desiredOutcomes ?? [];

  // Parse prohibitive constraint keywords (e.g. "no animations", "avoid serif")
  // Prevents positive keywords like "must look modern" from accidentally disqualifying "modern" directions
  const prohibitivePatterns = [
    /\bno\s+([a-z-]+)/i,
    /\bavoid\s+([a-z-]+)/i,
    /\bdo not use\s+([a-z-]+)/i,
    /\bdon't use\s+([a-z-]+)/i,
    /\bnever\s+([a-z-]+)/i,
    /\bwithout\s+([a-z-]+)/i,
    /\bprohibit\s+([a-z-]+)/i,
  ];

  const prohibitedWords: string[] = [];
  for (const c of constraints) {
    for (const pat of prohibitivePatterns) {
      const match = c.match(pat);
      if (match?.[1]) {
        prohibitedWords.push(match[1].toLowerCase());
      }
    }
  }

  const filtered = directions.filter((dir) => {
    if (prohibitedWords.length === 0) return true;
    for (const axis of dir.axes) {
      const positionWords = axis.position.toLowerCase().split("-");
      for (const word of positionWords) {
        if (prohibitedWords.includes(word) && word.length > 2) {
          return false;
        }
      }
    }
    return true;
  });

  // If constraints eliminate all directions, gracefully fall back to base directions
  const candidates = filtered.length > 0 ? filtered : directions;

  const enriched = candidates.map((dir, idx) => {
    const dominantVisual =
      dir.axes.find((a) => a.axis === "layout-density")?.position ?? "standard";
    const typoStyle =
      dir.axes.find((a) => a.axis === "typography-character")?.position ??
      "modern";
    const colorStyle =
      dir.axes.find((a) => a.axis === "color-temperature")?.position ??
      "balanced";

    const taskContext = taskDescription.trim()
      ? ` Tailored to task "${taskDescription.slice(0, 80)}".`
      : "";
    const outcomeNote =
      outcomes.length > 0
        ? ` Aims to advance client outcomes: ${outcomes.slice(0, 2).join("; ")}.`
        : "";

    return {
      ...dir,
      rationale: `Explores a ${dominantVisual} composition with ${typoStyle} typography and a ${colorStyle} palette.${taskContext}${outcomeNote}`,
      priority: idx + 1,
    };
  });

  return enriched;
}

/** Save design directions to the task directory. */
export async function saveDesignDirections(
  workspacePath: string,
  taskId: string,
  directions: DesignDirection[],
): Promise<string> {
  const dir = path.join(workspacePath, "tasks", taskId);
  await ensureDir(dir);
  const fp = path.join(dir, "design-directions.json");
  await writeJson(fp, directions);
  return fp;
}

/** Load saved design directions for a task. Returns null if not found. */
export async function loadDesignDirections(
  workspacePath: string,
  taskId: string,
): Promise<DesignDirection[] | null> {
  const fp = path.join(
    workspacePath,
    "tasks",
    taskId,
    "design-directions.json",
  );
  if (!(await pathExists(fp))) return null;
  return readJson<DesignDirection[]>(fp);
}
