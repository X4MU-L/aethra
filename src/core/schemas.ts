/**
 * Core Zod schemas and TypeScript types for the Aethra workbench.
 * All data flowing through the system must conform to these schemas.
 */

import { z } from "zod";

// ─── Primitive schemas ────────────────────────────────────────────────────────

export const IsoTimestampSchema = z.string().datetime({ offset: true });
export const SemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+/, "Must be semver");
export const UrlSchema = z.string().url();

// ─── Platform ────────────────────────────────────────────────────────────────

export const PlatformTypeSchema = z.enum([
  "wordpress",
  "woocommerce",
  "shopify",
  "nextjs",
  "react",
  "node",
  "static",
  "unknown",
  "hybrid",
]);
export type PlatformType = z.infer<typeof PlatformTypeSchema>;

export const PlatformDetectionSchema = z.object({
  platform: PlatformTypeSchema,
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  detectedAt: IsoTimestampSchema,
});
export type PlatformDetection = z.infer<typeof PlatformDetectionSchema>;

// ─── Client facts ─────────────────────────────────────────────────────────────

export const ClientFactsSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  description: z.string().optional(),
  objectives: z.array(z.string()).default([]),
  targetCustomers: z.string().optional(),
  knownUrls: z.array(z.string().url()).default([]),
  primaryUrl: z.string().url().optional(),
  locations: z.array(z.string()).default([]),
  services: z.array(z.string()).default([]),
  knownPlatform: PlatformTypeSchema.optional(),
  knownIntegrations: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  desiredOutcomes: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  confidentialityNotes: z.string().optional(),
  sourceFiles: z.array(z.string()).default([]),
  suppliedAt: IsoTimestampSchema.optional(),
});
export type ClientFacts = z.infer<typeof ClientFactsSchema>;

// ─── Client configuration ──────────────────────────────────────────────────────

export const LocalDevToolSchema = z.enum([
  "ddev",
  "localwp",
  "docker",
  "none",
  "unknown",
]);
export type LocalDevTool = z.infer<typeof LocalDevToolSchema>;

export const ClientConfigSchema = z.object({
  version: z.string().default("1"),
  slug: z.string(),
  name: z.string(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  platform: PlatformTypeSchema.optional(),
  platformConfidence: z.number().min(0).max(1).optional(),
  primaryUrl: z.string().url().optional(),
  repositoryPath: z.string().optional(),
  localDevTool: LocalDevToolSchema.optional(),
  localUrl: z.string().url().optional(),
  workspace: z.string(),
  auditSettings: z
    .object({
      maxPages: z.number().default(50),
      timeoutMs: z.number().default(30000),
      captureScreenshots: z.boolean().default(true),
      runLighthouse: z.boolean().default(true),
      runAccessibility: z.boolean().default(true),
      importantPages: z.array(z.string()).default([]),
      viewports: z
        .array(
          z.object({
            name: z.string(),
            width: z.number(),
            height: z.number(),
          }),
        )
        .default([
          { name: "desktop", width: 1440, height: 900 },
          { name: "mobile", width: 375, height: 812 },
        ]),
    })
    .default({}),
  visualFeedback: z
    .object({
      enabled: z.boolean().default(false),
      defaultProvider: z.string().default("manual"),
      watchIntervalMs: z.number().default(10000),
      autoImport: z.boolean().default(false),
    })
    .default({}),
  skills: z.array(z.string()).default([]),
  enabledIntegrations: z.array(z.string()).default([]),
});
export type ClientConfig = z.infer<typeof ClientConfigSchema>;

// ─── Audit evidence ───────────────────────────────────────────────────────────

export const EvidenceTypeSchema = z.enum([
  "screenshot",
  "lighthouse",
  "accessibility",
  "http-check",
  "console-errors",
  "network-errors",
  "platform-detection",
  "html-metadata",
  "links",
  "forms",
  "browser-test",
  "manual",
  "visual-feedback",
]);
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;

export const EvidenceItemSchema = z.object({
  path: z.string(),
  type: EvidenceTypeSchema,
  description: z.string().optional(),
  capturedAt: IsoTimestampSchema.optional(),
  url: z.string().optional(),
  viewport: z.string().optional(),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const FindingSeveritySchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const FindingStatusSchema = z.enum([
  "observed",
  "verified",
  "resolved",
  "wont-fix",
  "needs-review",
]);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const FindingSchema = z.object({
  id: z.string(),
  category: z.string(),
  severity: FindingSeveritySchema,
  title: z.string(),
  description: z.string().optional(),
  status: FindingStatusSchema.default("observed"),
  evidence: z.array(EvidenceItemSchema).default([]),
  confidence: z.number().min(0).max(1).optional(),
  recommendation: z.string().optional(),
  verificationRequired: z.boolean().default(true),
  url: z.string().optional(),
  viewport: z.string().optional(),
  createdAt: IsoTimestampSchema.optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const AuditRunSchema = z.object({
  id: z.string(),
  clientSlug: z.string(),
  type: z.enum(["baseline", "refresh", "local"]),
  startedAt: IsoTimestampSchema,
  completedAt: IsoTimestampSchema.optional(),
  status: z.enum(["running", "completed", "failed", "partial"]),
  targetUrl: z.string().url().optional(),
  pagesInspected: z.array(z.string()).default([]),
  findings: z.array(FindingSchema).default([]),
  artifactManifest: z.array(EvidenceItemSchema).default([]),
  errors: z.array(z.string()).default([]),
  limitations: z.array(z.string()).default([]),
  environment: z.object({
    os: z.string(),
    nodeVersion: z.string(),
    playwrightVersion: z.string().optional(),
    lighthouseVersion: z.string().optional(),
    note: z.string().optional(),
  }),
});
export type AuditRun = z.infer<typeof AuditRunSchema>;

// ─── HTTP check ───────────────────────────────────────────────────────────────

export const HttpCheckResultSchema = z.object({
  url: z.string(),
  status: z.number().optional(),
  redirectedTo: z.string().optional(),
  reachable: z.boolean(),
  latencyMs: z.number().optional(),
  error: z.string().optional(),
  checkedAt: IsoTimestampSchema,
  headers: z.record(z.string()).optional(),
});
export type HttpCheckResult = z.infer<typeof HttpCheckResultSchema>;

// ─── Page inspection ──────────────────────────────────────────────────────────

export const PageInspectionSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  h1: z.array(z.string()).default([]),
  headings: z
    .array(z.object({ level: z.number(), text: z.string() }))
    .default([]),
  canonicalUrl: z.string().optional(),
  ogTags: z.record(z.string()).optional(),
  links: z
    .object({
      internal: z.array(z.string()).default([]),
      external: z.array(z.string()).default([]),
      broken: z.array(z.string()).default([]),
    })
    .default({}),
  forms: z
    .array(
      z.object({
        action: z.string().optional(),
        method: z.string().optional(),
        fields: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  consoleErrors: z.array(z.string()).default([]),
  networkErrors: z.array(z.string()).default([]),
  screenshots: z.record(z.string()).default({}),
  inspectedAt: IsoTimestampSchema,
});
export type PageInspection = z.infer<typeof PageInspectionSchema>;

// ─── Skills ───────────────────────────────────────────────────────────────────

export const SkillStatusSchema = z.enum([
  "approved",
  "experimental",
  "deprecated",
  "draft",
]);
export type SkillStatus = z.infer<typeof SkillStatusSchema>;

export const SkillMetadataSchema = z.object({
  name: z.string(),
  version: SemverSchema,
  description: z.string(),
  status: SkillStatusSchema,
  category: z.string(),
  whenToInvoke: z.string(),
  requiredInputs: z.array(z.string()).default([]),
  preconditions: z.array(z.string()).default([]),
  requiredTools: z.array(z.string()).default([]),
  requiredPermissions: z.array(z.string()).default([]),
  expectedOutputs: z.array(z.string()).default([]),
  safetyConstraints: z.array(z.string()).default([]),
  platforms: z.array(PlatformTypeSchema).optional(),
  examples: z.array(z.string()).default([]),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});
export type SkillMetadata = z.infer<typeof SkillMetadataSchema>;

// ─── Plans ────────────────────────────────────────────────────────────────────

export const PlanStatusSchema = z.enum([
  "draft",
  "approved",
  "in-progress",
  "completed",
  "abandoned",
]);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

export const AcceptanceCriterionSchema = z.object({
  id: z.string(),
  description: z.string(),
  category: z.enum([
    "behaviour",
    "performance",
    "accessibility",
    "visual",
    "analytics",
    "test",
  ]),
  verificationMethod: z.string(),
  passed: z.boolean().optional(),
  verifiedAt: IsoTimestampSchema.optional(),
  notes: z.string().optional(),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

export const PlanSnapshotSchema = z.object({
  gitCommit: z.string().optional(),
  gitBranch: z.string().optional(),
  auditId: z.string().optional(),
});
export type PlanSnapshot = z.infer<typeof PlanSnapshotSchema>;

export const ImplementationPlanSchema = z.object({
  id: z.string(),
  title: z.string(),
  taskDescription: z.string(),
  clientSlug: z.string(),
  status: PlanStatusSchema.default("draft"),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  evidenceBasis: z.array(EvidenceItemSchema).default([]),
  affectedFiles: z.array(z.string()).default([]),
  affectedRoutes: z.array(z.string()).default([]),
  rootCause: z.string().optional(),
  rootCauseConfidence: z.number().min(0).max(1).optional(),
  proposedChanges: z
    .array(
      z.object({
        description: z.string(),
        files: z.array(z.string()).default([]),
        rationale: z.string().optional(),
      }),
    )
    .default([]),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).default([]),
  risks: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  estimatedScope: z.enum(["trivial", "small", "medium", "large"]).optional(),
  gitBranch: z.string().optional(),
  approvedBy: z.string().optional(),
  approvedAt: IsoTimestampSchema.optional(),
  planSnapshot: PlanSnapshotSchema.optional(),
  feedbackIds: z.array(z.string()).default([]),
});
export type ImplementationPlan = z.infer<typeof ImplementationPlanSchema>;

// ─── Task lifecycle ───────────────────────────────────────────────────────────

export const TaskStatusSchema = z.enum([
  "planned", // plan created, awaiting approval
  "approved", // approved for implementation
  "in-progress", // implementation underway
  "verifying", // verification running
  "completed", // verified and done
  "blocked", // blocked — reason in notes
  "abandoned", // no longer relevant
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  clientSlug: z.string(),
  status: TaskStatusSchema.default("planned"),
  planId: z.string(),
  planPath: z.string(), // absolute path to plan JSON
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  approvedBy: z.string().optional(),
  approvedAt: IsoTimestampSchema.optional(),
  startedAt: IsoTimestampSchema.optional(),
  completedAt: IsoTimestampSchema.optional(),
  gitBranch: z.string().optional(),
  verificationId: z.string().optional(),
  notes: z.string().optional(),
  feedbackIds: z.array(z.string()).default([]),
});
export type TaskRecord = z.infer<typeof TaskRecordSchema>;

// ─── Tool check ───────────────────────────────────────────────────────────────

export const ToolCheckStatusSchema = z.enum([
  "ok",
  "warning",
  "missing",
  "error",
]);
export type ToolCheckStatus = z.infer<typeof ToolCheckStatusSchema>;

export const ToolCheckSchema = z.object({
  name: z.string(),
  required: z.boolean(),
  status: ToolCheckStatusSchema,
  version: z.string().optional(),
  path: z.string().optional(),
  message: z.string().optional(),
  installHint: z.string().optional(),
});
export type ToolCheck = z.infer<typeof ToolCheckSchema>;

// ─── Workspace state ──────────────────────────────────────────────────────────

export const OnboardingStageSchema = z.enum([
  "facts-read",
  "research-discovery",
  "baseline-audit",
  "workspace-created",
  "platform-determined",
  "agent-tooling",
  "validated",
]);
export type OnboardingStage = z.infer<typeof OnboardingStageSchema>;

export const WorkspaceStateSchema = z.object({
  version: z.string().default("1"),
  clientSlug: z.string(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  completedStages: z.array(OnboardingStageSchema).default([]),
  currentStage: OnboardingStageSchema.optional(),
  errors: z.record(z.string()).default({}),
  lastAuditId: z.string().optional(),
  lastAuditAt: IsoTimestampSchema.optional(),
});
export type WorkspaceState = z.infer<typeof WorkspaceStateSchema>;

// ─── Global config ────────────────────────────────────────────────────────────

export const GlobalConfigSchema = z.object({
  version: z.string().default("1"),
  workspaceRoot: z.string().default("~/Aethra/clients"),
  defaults: z
    .object({
      browser: z.enum(["chromium", "firefox", "webkit"]).default("chromium"),
      audit: z
        .object({
          maxPages: z.number().default(50),
          timeoutMs: z.number().default(30000),
          captureScreenshots: z.boolean().default(true),
          runLighthouse: z.boolean().default(true),
          runAccessibility: z.boolean().default(true),
          concurrency: z.number().default(3),
          requestDelayMs: z.number().default(500),
        })
        .default({}),
    })
    .default({}),
  agents: z
    .object({
      defaultCodingAgent: z.string().default("claude-code"),
      allowParallelTasks: z.boolean().default(true),
      requirePlanBeforeEdits: z.boolean().default(true),
    })
    .default({}),
  safety: z
    .object({
      allowProductionMutations: z.boolean().default(false),
      requireApprovalForExternalWrites: z.boolean().default(true),
      redactSensitiveLogs: z.boolean().default(true),
    })
    .default({}),
});
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

// ─── Task classification ─────────────────────────────────────────────────────

export const TaskClassificationSchema = z.enum([
  "direct-fix",
  "design-exploration",
  "technical-illustration",
  "conventional-engineering",
]);
export type TaskClassification = z.infer<typeof TaskClassificationSchema>;

export const TaskClassificationResultSchema = z.object({
  classification: TaskClassificationSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  signals: z.array(z.string()).default([]),
  requiresDesignWorkflow: z.boolean(),
});
export type TaskClassificationResult = z.infer<
  typeof TaskClassificationResultSchema
>;

// ─── Capability registry ─────────────────────────────────────────────────────

export const CapabilityStatusSchema = z.enum([
  "available",
  "unavailable",
  "degraded",
  "requires-setup",
]);
export type CapabilityStatus = z.infer<typeof CapabilityStatusSchema>;

export const CapabilityCategorySchema = z.enum([
  "browser-automation",
  "visual-annotation",
  "illustration",
  "testing",
  "code-analysis",
  "deployment",
  "design-evaluation",
  "screenshot-capture",
  "performance-testing",
  "accessibility-testing",
]);
export type CapabilityCategory = z.infer<typeof CapabilityCategorySchema>;

export const CostClassSchema = z.enum([
  "free",
  "local-compute",
  "api-call",
  "model-call",
  "external-service",
]);
export type CostClass = z.infer<typeof CostClassSchema>;

export const WorkflowStageSchema = z.enum([
  "investigate",
  "plan",
  "implement",
  "verify",
]);
export type WorkflowStage = z.infer<typeof WorkflowStageSchema>;

export const CapabilityEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  category: CapabilityCategorySchema,
  description: z.string(),
  applicableTasks: z.array(TaskClassificationSchema).default([]),
  supportedPlatforms: z.array(PlatformTypeSchema).optional(),
  workflowStages: z.array(WorkflowStageSchema).default([]),
  prerequisites: z.array(z.string()).default([]),
  costClass: CostClassSchema,
  status: CapabilityStatusSchema.default("available"),
});
export type CapabilityEntry = z.infer<typeof CapabilityEntrySchema>;

// ─── Integration metadata ────────────────────────────────────────────────────

export const IntegrationStatusSchema = z.enum([
  "implemented",
  "planned",
  "deprecated",
  "experimental",
]);
export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;

export const IntegrationMetadataSchema = z.object({
  source: z.object({
    name: z.string().min(1),
    upstream_url: z.string().url(),
    repository_url: z.string().url(),
    subdirectory: z.string().optional(),
    author: z.string(),
    license: z.string(),
    version: z.string(),
    pinned_ref: z.string(),
  }),
  import: z.object({
    date: z.union([z.string(), z.number()]),
    imported_by: z.string(),
    purpose: z.string(),
  }),
  attribution: z.object({
    required: z.boolean(),
    notice: z.string(),
  }),
  classification: z
    .object({
      status: IntegrationStatusSchema,
      integration_type: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
});
export type IntegrationMetadata = z.infer<typeof IntegrationMetadataSchema>;

// ─── Design schemas ──────────────────────────────────────────────────────────

export const DesignAxisSchema = z.object({
  axis: z.string(),
  position: z.string(),
  description: z.string(),
});
export type DesignAxis = z.infer<typeof DesignAxisSchema>;

export const DesignDirectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  axes: z.array(DesignAxisSchema),
  rationale: z.string(),
  thumbnail: z.string().optional(),
  priority: z.number().optional(),
});
export type DesignDirection = z.infer<typeof DesignDirectionSchema>;

export const DesignBriefSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  clientSlug: z.string(),
  selectedDirectionId: z.string(),
  aesthetic: z.string(),
  composition: z.string(),
  hierarchy: z.string(),
  typography: z.string(),
  colors: z.array(z.string()).default([]),
  imageStrategy: z.string(),
  interactionCharacter: z.string(),
  responsiveBehavior: z.string(),
  antiPatterns: z.array(z.string()).default([]),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});
export type DesignBrief = z.infer<typeof DesignBriefSchema>;

export const CritiqueScoreSchema = z.object({
  dimension: z.string(),
  score: z.number().min(0).max(10),
  observation: z.string(),
  suggestion: z.string(),
});
export type CritiqueScore = z.infer<typeof CritiqueScoreSchema>;

export const CritiqueReviewStatusSchema = z.enum(["pending", "completed"]);
export type CritiqueReviewStatus = z.infer<typeof CritiqueReviewStatusSchema>;

export const CritiqueResultSchema = z.object({
  id: z.string(),
  taskId: z.string().optional(),
  briefId: z.string().optional(),
  screenshotPaths: z.array(z.string()).default([]),
  scores: z.array(CritiqueScoreSchema).default([]),
  overallScore: z.number().min(0).max(10),
  summary: z.string(),
  strengths: z.array(z.string()).default([]),
  improvements: z.array(z.string()).default([]),
  accessibilityNotes: z.array(z.string()).default([]),
  reviewStatus: CritiqueReviewStatusSchema.default("completed"),
  critiquePrompt: z.string().optional(),
  createdAt: IsoTimestampSchema,
});
export type CritiqueResult = z.infer<typeof CritiqueResultSchema>;
