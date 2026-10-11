/**
 * Design brief generator.
 * Creates a detailed design brief from a selected direction, translating
 * axis values into actionable design specifications and auto-deriving
 * anti-patterns to avoid.
 */

import crypto from "crypto";
import path from "path";
import type { DesignBrief, DesignDirection } from "../core/schemas.js";
import { writeJson, readJson, pathExists, ensureDir } from "../engine/fs.js";

// ─── Axis-to-brief mappings ─────────────────────────────────────────────────

const AESTHETIC_MAP: Record<string, string> = {
  "geometric-modern":
    "Clean, mathematical precision with sharp lines and geometric shapes",
  "humanist-warm": "Organic and inviting, with rounded forms and natural flow",
  "serif-authoritative":
    "Classic and authoritative, rooted in traditional typographic craft",
  "monospace-technical":
    "Technical and precise, with a developer-centric, raw aesthetic",
};

const COMPOSITION_MAP: Record<string, string> = {
  "spacious-editorial":
    "Generous margins and breathing room; content floats in ample whitespace",
  "balanced-standard":
    "Conventional grid with comfortable spacing and predictable rhythm",
  "compact-information-dense":
    "High-density layout maximizing visible content per viewport",
};

const HIERARCHY_MAP: Record<string, string> = {
  "hero-dominant":
    "Single dominant visual anchors each section; clear focal points guide the eye",
  "grid-equal-weight":
    "Content distributed evenly across a structured grid; democratic layout",
  "progressive-reveal":
    "Layered content disclosure; each scroll reveals the next level of detail",
  "sidebar-content":
    "Persistent sidebar provides context while main column carries content",
};

const INTERACTION_MAP: Record<string, string> = {
  "minimal-static":
    "No motion; instant state changes; content-first, zero distraction",
  "subtle-transitions": "Gentle fades and slides easing cognitive transitions",
  "rich-animated":
    "Purposeful motion design reinforcing spatial relationships and feedback",
  "scroll-driven":
    "Scroll-triggered reveals and parallax layers creating narrative depth",
};

const IMAGE_STRATEGY_MAP: Record<string, string> = {
  "photography-led":
    "Photography as the primary visual driver; full-bleed and hero imagery",
  "illustration-led":
    "Custom illustrations convey brand personality and abstract concepts",
  "icon-led":
    "Systematic iconography providing visual shorthand and pattern recognition",
  "typography-only":
    "Type is the image; scale, weight, and spacing create visual interest",
};

const COLOR_PALETTE_MAP: Record<string, string[]> = {
  "cool-professional": ["#1a365d", "#2b6cb0", "#e2e8f0", "#f7fafc", "#2d3748"],
  "warm-approachable": ["#7b341e", "#c05621", "#feebc8", "#fffaf0", "#744210"],
  "neutral-minimal": ["#1a202c", "#4a5568", "#e2e8f0", "#ffffff", "#a0aec0"],
  "vibrant-energetic": ["#6b21a8", "#d53f8c", "#fefcbf", "#f0fff4", "#2b6cb0"],
};

const RESPONSIVE_MAP: Record<string, string> = {
  "spacious-editorial":
    "Graceful reflow; single column on mobile preserving generous spacing",
  "balanced-standard":
    "Standard responsive breakpoints; stacked on mobile, multi-column on desktop",
  "compact-information-dense":
    "Collapsible sections and tabbed panels on smaller viewports",
};

// ─── Anti-pattern derivation ────────────────────────────────────────────────

const ANTI_PATTERN_MAP: Record<string, string[]> = {
  "spacious-editorial": [
    "Avoid cramming content into tight spaces",
    "Do not use dense data tables without clear separation",
  ],
  "balanced-standard": [
    "Avoid extreme whitespace or extreme density",
    "Do not deviate from established grid rhythm",
  ],
  "compact-information-dense": [
    "Avoid large decorative images that waste viewport space",
    "Do not sacrifice readability for density",
  ],
  "hero-dominant": [
    "Avoid competing CTAs at the same visual weight",
    "Do not place secondary content at the same prominence as the hero",
  ],
  "grid-equal-weight": [
    "Avoid a single oversized element that breaks grid equality",
    "Do not create visual hierarchy where none is intended",
  ],
  "progressive-reveal": [
    "Avoid showing all content at once without layering",
    "Do not hide critical information behind too many layers",
  ],
  "sidebar-content": [
    "Avoid sidebar content competing with main content for attention",
    "Do not collapse navigation on desktop where sidebar is expected",
  ],
  "minimal-static": [
    "Avoid gratuitous animations or transitions",
    "Do not add hover effects that feel inconsistent with the static approach",
  ],
  "subtle-transitions": [
    "Avoid jarring or fast animations that contradict the gentle aesthetic",
    "Do not use scroll-hijacking or parallax",
  ],
  "rich-animated": [
    "Avoid motion that does not serve a functional purpose",
    "Do not animate without respecting prefers-reduced-motion",
  ],
  "scroll-driven": [
    "Avoid static sections that break the scroll narrative",
    "Do not use scroll-jacking that prevents normal browser scrolling",
  ],
  "photography-led": [
    "Avoid low-quality or generic stock photography",
    "Do not let illustrations compete with photographic imagery",
  ],
  "illustration-led": [
    "Avoid mixing photographic and illustrative styles inconsistently",
    "Do not use generic clip art in place of purposeful illustration",
  ],
  "icon-led": [
    "Avoid inconsistent icon styles or mixing icon families",
    "Do not use icons without clear meaning or labels",
  ],
  "typography-only": [
    "Avoid decorative images that undermine the type-only approach",
    "Do not use too many typefaces or weights",
  ],
  "geometric-modern": [
    "Avoid decorative or ornamental type treatments",
    "Do not mix geometric type with highly organic imagery",
  ],
  "humanist-warm": [
    "Avoid cold, rigid layouts that contradict the warm type character",
    "Do not use purely mechanical spacing",
  ],
  "serif-authoritative": [
    "Avoid playful or informal design elements that clash with authority",
    "Do not pair serifs with overly casual imagery",
  ],
  "monospace-technical": [
    "Avoid flowery or decorative design language",
    "Do not use proportional type for data that benefits from alignment",
  ],
  "cool-professional": [
    "Avoid warm accent colors that clash with the cool palette",
    "Do not over-saturate blues into neon territory",
  ],
  "warm-approachable": [
    "Avoid cold grays or stark black-and-white contrasts",
    "Do not use warm tones so heavily that readability suffers",
  ],
  "neutral-minimal": [
    "Avoid introducing bright accent colors without clear purpose",
    "Do not make the design feel lifeless; use contrast intentionally",
  ],
  "vibrant-energetic": [
    "Avoid muted tones that contradict the energetic palette",
    "Do not combine too many vibrant colors without a dominant hue",
  ],
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getAxisPosition(
  direction: DesignDirection,
  axisName: string,
): string | undefined {
  return direction.axes.find((a) => a.axis === axisName)?.position;
}

function deriveAntiPatterns(direction: DesignDirection): string[] {
  const patterns: string[] = [];
  for (const axis of direction.axes) {
    const axisPatterns = ANTI_PATTERN_MAP[axis.position];
    if (axisPatterns) {
      patterns.push(...axisPatterns);
    }
  }
  return patterns;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Create a design brief from a selected design direction. */
export function createDesignBrief(
  taskId: string,
  clientSlug: string,
  selectedDirection: DesignDirection,
): DesignBrief {
  const now = new Date().toISOString();

  const typographyPos =
    getAxisPosition(selectedDirection, "typography-character") ??
    "humanist-warm";
  const layoutPos =
    getAxisPosition(selectedDirection, "layout-density") ?? "balanced-standard";
  const colorPos =
    getAxisPosition(selectedDirection, "color-temperature") ??
    "neutral-minimal";
  const hierarchyPos =
    getAxisPosition(selectedDirection, "hierarchy-strategy") ??
    "grid-equal-weight";
  const interactionPos =
    getAxisPosition(selectedDirection, "interaction-weight") ??
    "subtle-transitions";
  const imageryPos =
    getAxisPosition(selectedDirection, "imagery-role") ?? "photography-led";

  return {
    id: crypto.randomBytes(8).toString("hex"),
    taskId,
    clientSlug,
    selectedDirectionId: selectedDirection.id,
    aesthetic:
      AESTHETIC_MAP[typographyPos] ?? `Aesthetic guided by ${typographyPos}`,
    composition:
      COMPOSITION_MAP[layoutPos] ?? `Composition guided by ${layoutPos}`,
    hierarchy:
      HIERARCHY_MAP[hierarchyPos] ?? `Hierarchy guided by ${hierarchyPos}`,
    typography: typographyPos,
    colors: COLOR_PALETTE_MAP[colorPos] ?? [
      "#1a202c",
      "#4a5568",
      "#e2e8f0",
      "#ffffff",
    ],
    imageStrategy:
      IMAGE_STRATEGY_MAP[imageryPos] ??
      `Image strategy guided by ${imageryPos}`,
    interactionCharacter:
      INTERACTION_MAP[interactionPos] ??
      `Interaction guided by ${interactionPos}`,
    responsiveBehavior:
      RESPONSIVE_MAP[layoutPos] ??
      "Standard responsive breakpoints with mobile-first approach",
    antiPatterns: deriveAntiPatterns(selectedDirection),
    createdAt: now,
    updatedAt: now,
  };
}

/** Save a design brief to the task directory. */
export async function saveDesignBrief(
  workspacePath: string,
  brief: DesignBrief,
): Promise<string> {
  const dir = path.join(workspacePath, "tasks", brief.taskId);
  await ensureDir(dir);
  const fp = path.join(dir, "design-brief.json");
  await writeJson(fp, brief);
  return fp;
}

/** Load a design brief from the task directory. Returns null if not found. */
export async function loadDesignBrief(
  workspacePath: string,
  taskId: string,
): Promise<DesignBrief | null> {
  const fp = path.join(workspacePath, "tasks", taskId, "design-brief.json");
  if (!(await pathExists(fp))) return null;
  return readJson<DesignBrief>(fp);
}
