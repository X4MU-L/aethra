/**
 * Task classifier.
 * Determines whether a task requires design exploration, direct fix,
 * technical illustration, or conventional engineering.
 *
 * Uses deterministic keyword matching with weighted signals,
 * following the same probabilistic combination as src/platforms/detector.ts.
 */

import type {
  TaskClassification,
  TaskClassificationResult,
  PlatformType,
} from "../core/schemas.js";

interface ClassificationSignal {
  classification: TaskClassification;
  weight: number;
  evidence: string;
}

const KEYWORD_SIGNALS: Array<{
  keywords: string[];
  classification: TaskClassification;
  weight: number;
}> = [
  // Direct fix signals
  {
    keywords: ["fix", "bug", "broken", "error", "crash"],
    classification: "direct-fix",
    weight: 0.7,
  },
  {
    keywords: ["defect", "regression", "not working", "fails"],
    classification: "direct-fix",
    weight: 0.7,
  },
  {
    keywords: ["alignment", "missing", "wrong", "incorrect"],
    classification: "direct-fix",
    weight: 0.5,
  },
  {
    keywords: ["console error", "network error", "404", "500"],
    classification: "direct-fix",
    weight: 0.8,
  },
  {
    keywords: ["overflow", "clipping", "wrapping", "spacing"],
    classification: "direct-fix",
    weight: 0.5,
  },

  // Design exploration signals
  {
    keywords: ["redesign", "new design", "visual identity"],
    classification: "design-exploration",
    weight: 0.8,
  },
  {
    keywords: ["brand", "look and feel", "aesthetic"],
    classification: "design-exploration",
    weight: 0.7,
  },
  {
    keywords: ["ui overhaul", "homepage redesign", "landing page design"],
    classification: "design-exploration",
    weight: 0.9,
  },
  {
    keywords: ["visual direction", "design system", "style guide"],
    classification: "design-exploration",
    weight: 0.7,
  },
  {
    keywords: ["hero section", "above the fold", "visual refresh"],
    classification: "design-exploration",
    weight: 0.6,
  },
  {
    keywords: ["creative", "concept", "mockup", "prototype"],
    classification: "design-exploration",
    weight: 0.6,
  },

  // Technical illustration signals
  {
    keywords: ["diagram", "architecture diagram", "flow chart"],
    classification: "technical-illustration",
    weight: 0.8,
  },
  {
    keywords: ["illustrate", "visual guide", "visual explainer"],
    classification: "technical-illustration",
    weight: 0.7,
  },
  {
    keywords: ["explain how", "document the flow", "infographic"],
    classification: "technical-illustration",
    weight: 0.5,
  },
  {
    keywords: ["svg", "technical drawing"],
    classification: "technical-illustration",
    weight: 0.6,
  },

  // Conventional engineering signals
  {
    keywords: ["api", "backend", "database", "migration"],
    classification: "conventional-engineering",
    weight: 0.7,
  },
  {
    keywords: ["refactor", "deploy", "ci/cd", "pipeline"],
    classification: "conventional-engineering",
    weight: 0.6,
  },
  {
    keywords: ["test coverage", "performance optimization"],
    classification: "conventional-engineering",
    weight: 0.5,
  },
  {
    keywords: ["server", "endpoint", "query", "schema"],
    classification: "conventional-engineering",
    weight: 0.5,
  },
  {
    keywords: ["dependency", "upgrade", "security patch"],
    classification: "conventional-engineering",
    weight: 0.6,
  },
];

/**
 * Classify a task using deterministic keyword matching.
 * Returns the classification with highest confidence, or 'direct-fix' as default.
 */
export function classifyTask(
  taskDescription: string,
  platform?: PlatformType,
  hasVisualEvidence?: boolean,
): TaskClassificationResult {
  const taskLower = taskDescription.toLowerCase();
  const signals: ClassificationSignal[] = [];

  // Collect keyword signals
  for (const { keywords, classification, weight } of KEYWORD_SIGNALS) {
    for (const keyword of keywords) {
      if (taskLower.includes(keyword)) {
        signals.push({
          classification,
          weight,
          evidence: `Keyword: "${keyword}"`,
        });
        break; // Only count each signal group once
      }
    }
  }

  // Platform-based signals
  if (platform === "react" || platform === "nextjs") {
    if (hasVisualEvidence) {
      signals.push({
        classification: "direct-fix",
        weight: 0.3,
        evidence: "Visual evidence on React/Next.js",
      });
    }
  }

  // Aggregate scores using probabilistic combination
  const scores: Record<
    TaskClassification,
    { total: number; signals: string[] }
  > = {
    "direct-fix": { total: 0, signals: [] },
    "design-exploration": { total: 0, signals: [] },
    "technical-illustration": { total: 0, signals: [] },
    "conventional-engineering": { total: 0, signals: [] },
  };

  for (const signal of signals) {
    const entry = scores[signal.classification];
    entry.total = 1 - (1 - entry.total) * (1 - signal.weight);
    entry.signals.push(signal.evidence);
  }

  // Find the classification with the highest score
  let bestClassification: TaskClassification = "direct-fix";
  let bestScore = 0;

  for (const [classification, { total }] of Object.entries(scores) as Array<
    [TaskClassification, { total: number }]
  >) {
    if (total > bestScore) {
      bestScore = total;
      bestClassification = classification;
    }
  }

  // Default to direct-fix with low confidence if no signals matched
  if (bestScore === 0) {
    bestScore = 0.3;
  }

  const requiresDesignWorkflow =
    bestClassification === "design-exploration" ||
    bestClassification === "technical-illustration";

  const bestEntry = scores[bestClassification];
  const reasoning =
    bestEntry.signals.length > 0
      ? `Classified as ${bestClassification} based on: ${bestEntry.signals.join(", ")}`
      : `Default classification (no strong signals detected)`;

  return {
    classification: bestClassification,
    confidence: Math.min(bestScore, 1),
    reasoning,
    signals: bestEntry.signals,
    requiresDesignWorkflow,
  };
}
