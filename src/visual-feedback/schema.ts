/**
 * Visual feedback schemas.
 * Normalizes annotations from different providers (Agentation, manual, etc.)
 * into a common Aethra representation.
 */

import { z } from "zod";
import { IsoTimestampSchema, FindingSeveritySchema } from "../core/schemas.js";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const VisualFeedbackKindSchema = z.enum([
  "bug", // something broken
  "enhancement", // improve existing
  "question", // clarification needed
  "content", // content change request
  "style", // visual/CSS change
  "accessibility", // a11y issue
  "other",
]);
export type VisualFeedbackKind = z.infer<typeof VisualFeedbackKindSchema>;

export const VisualFeedbackIntentSchema = z.enum([
  "fix", // fix this specific thing
  "investigate", // look into this
  "approve", // this looks good
  "reject", // doesn't match expectations
  "comment", // informational, no action needed
]);
export type VisualFeedbackIntent = z.infer<typeof VisualFeedbackIntentSchema>;

export const VisualFeedbackStatusSchema = z.enum([
  "pending", // just received, not yet triaged
  "triaged", // reviewed, not yet assigned
  "linked", // associated with a task
  "in-progress", // task is being worked on
  "resolved", // fix applied and verified
  "dismissed", // intentionally not addressed
]);
export type VisualFeedbackStatus = z.infer<typeof VisualFeedbackStatusSchema>;

// ─── Supporting schemas ──────────────────────────────────────────────────────

export const BoundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type BoundingBox = z.infer<typeof BoundingBoxSchema>;

export const ViewportInfoSchema = z.object({
  width: z.number(),
  height: z.number(),
  deviceScaleFactor: z.number().optional(),
});
export type ViewportInfo = z.infer<typeof ViewportInfoSchema>;

// ─── Main visual feedback schema ─────────────────────────────────────────────

export const VisualFeedbackSchema = z.object({
  id: z.string(),
  provider: z.string(),
  providerAnnotationId: z.string().optional(),

  // Aethra context
  clientId: z.string(),
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  sessionId: z.string().optional(),

  // Location
  pageUrl: z.string().url(),
  viewport: ViewportInfoSchema.optional(),

  // Annotation content
  comment: z.string(),
  kind: VisualFeedbackKindSchema.default("other"),
  intent: VisualFeedbackIntentSchema.default("investigate"),
  severity: FindingSeveritySchema.default("medium"),

  // Element context
  elementTag: z.string().optional(),
  elementSelector: z.string().optional(),
  boundingBox: BoundingBoxSchema.optional(),

  // Code context (populated by investigation)
  sourceFile: z.string().optional(),
  componentTree: z.array(z.string()).optional(),
  cssClasses: z.array(z.string()).optional(),

  // Enrichment
  computedStyles: z.record(z.string()).optional(),
  accessibilityContext: z
    .object({
      role: z.string().optional(),
      ariaLabel: z.string().optional(),
      contrast: z.number().optional(),
      violations: z.array(z.string()).optional(),
    })
    .optional(),
  nearbyText: z.string().optional(),

  // Evidence
  screenshotReference: z.string().optional(),

  // Lifecycle
  createdAt: IsoTimestampSchema,
  status: VisualFeedbackStatusSchema.default("pending"),
  resolutionSummary: z.string().optional(),

  // Cross-references
  relatedFindingIds: z.array(z.string()).default([]),
  relatedFeedbackIds: z.array(z.string()).default([]),
});
export type VisualFeedback = z.infer<typeof VisualFeedbackSchema>;

// ─── Feedback session ────────────────────────────────────────────────────────

export const FeedbackSessionSchema = z.object({
  id: z.string(),
  clientSlug: z.string(),
  provider: z.string(),
  startedAt: IsoTimestampSchema,
  endedAt: IsoTimestampSchema.optional(),
  pageUrls: z.array(z.string()).default([]),
  feedbackIds: z.array(z.string()).default([]),
  status: z.enum(["active", "completed", "abandoned"]).default("active"),
  reviewerName: z.string().optional(),
});
export type FeedbackSession = z.infer<typeof FeedbackSessionSchema>;
