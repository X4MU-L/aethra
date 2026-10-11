/**
 * Aethra MCP Server — exposes workspace intelligence to Claude Code.
 *
 * Provides tools that let AI agents access structured client data,
 * audit findings, implementation plans, and workspace state without
 * needing to navigate the filesystem manually.
 *
 * Run via: npx aethra-mcp --workspace <path>
 * Or configured in Claude Code MCP settings.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { parseArgs } from "node:util";
import path from "path";
import fs from "fs-extra";
import yaml from "js-yaml";
import type {
  ClientConfig,
  WorkspaceState,
  ImplementationPlan,
  AuditRun,
} from "../core/schemas.js";
import {
  getDb,
  dbListTasks,
  dbLoadTask,
  dbFindTaskByPrefix,
  dbListFeedback,
  dbLoadFeedback,
  dbListPlans,
  dbGetSessionsForClient,
} from "../engine/db.js";

// ─── Server setup ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: "aethra", version: "0.1.0" },
  {
    capabilities: {
      tools: {},
      resources: { subscribe: true, listChanged: true },
    },
  },
);

function resolveWorkspacePath(): string {
  // When imported from CLI (aethra mcp start), AETHRA_WORKSPACE is set
  const envWorkspace = process.env["AETHRA_WORKSPACE"];
  if (envWorkspace) return envWorkspace;

  // When run standalone (aethra-mcp --workspace <path>)
  try {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      options: {
        workspace: { type: "string", short: "w" },
      },
      allowPositionals: true,
      strict: false,
    });

    const wp = (values.workspace as string) ?? positionals[0];
    if (wp) return wp;
  } catch {
    // Fall through
  }

  process.stderr.write(
    "Error: workspace path required. Use --workspace <path> or set AETHRA_WORKSPACE.\n",
  );
  process.exit(1);
}

const workspacePath = resolveWorkspacePath();

// Validate workspace upfront
const configCheckPath = path.join(workspacePath, "client.yaml");
if (!fs.pathExistsSync(configCheckPath)) {
  process.stderr.write(
    `Error: ${workspacePath} is not a valid Aethra workspace (no client.yaml found).\n`,
  );
  process.exit(1);
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: "aethra_get_client_config",
    description:
      "Get the structured client configuration for the active workspace. " +
      "Returns platform, URLs, repository path, audit settings, and metadata.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "aethra_get_client_facts",
    description:
      "Get the raw client facts: business description, objectives, services, " +
      "known integrations, constraints, and open questions.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "aethra_get_workspace_status",
    description:
      "Get the current workspace state including completed onboarding stages, " +
      "last activity, and any pending items.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "aethra_get_latest_audit",
    description:
      "Get the most recent audit run. Returns findings, pages inspected, " +
      "Lighthouse scores, screenshots, and limitations. " +
      "Use this to understand the current state of the client website.",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          enum: ["baseline", "refresh"],
          description: "Audit type to retrieve (default: baseline)",
        },
      },
      required: [],
    },
  },
  {
    name: "aethra_list_plans",
    description:
      "List all implementation plans in the workspace. " +
      "Returns plan IDs, titles, status, and creation dates.",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["draft", "approved", "in-progress", "completed", "cancelled"],
          description: "Filter plans by status",
        },
      },
      required: [],
    },
  },
  {
    name: "aethra_get_plan",
    description:
      "Get the full details of a specific implementation plan including " +
      "proposed changes, acceptance criteria, risks, and evidence basis.",
    inputSchema: {
      type: "object" as const,
      properties: {
        planId: {
          type: "string",
          description: "Plan ID or filename (without extension)",
        },
      },
      required: ["planId"],
    },
  },
  {
    name: "aethra_list_evidence",
    description:
      "List all evidence artifacts collected for this workspace " +
      "(screenshots, Lighthouse reports, audit JSONs).",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "aethra_get_knowledge",
    description:
      "Read a knowledge base file from the workspace knowledge/ directory. " +
      "Available files: client-facts.md, technical-baseline.md, open-questions.md, etc.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string",
          description:
            'Knowledge file name (e.g. "client-facts.md", "open-questions.md")',
        },
      },
      required: ["filename"],
    },
  },
  {
    name: "aethra_list_tasks",
    description:
      "List all tasks in the workspace with their status, plan ID, and timestamps. " +
      "Tasks track the lifecycle of implementation plans.",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: [
            "planned",
            "approved",
            "in-progress",
            "verifying",
            "completed",
            "blocked",
            "abandoned",
          ],
          description: "Filter tasks by status",
        },
      },
      required: [],
    },
  },
  {
    name: "aethra_get_task",
    description:
      "Get the full details of a specific task including status, plan reference, " +
      "timestamps, git branch, and verification results.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: {
          type: "string",
          description: "Task ID or prefix (first 8+ characters)",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "aethra_list_feedback",
    description:
      "List visual feedback annotations for the workspace. " +
      "Returns annotation IDs, comments, status, page URLs, and element context.",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: [
            "pending",
            "triaged",
            "linked",
            "in-progress",
            "resolved",
            "dismissed",
          ],
          description: "Filter feedback by status",
        },
        pageUrl: {
          type: "string",
          description: "Filter feedback by page URL",
        },
      },
      required: [],
    },
  },
  {
    name: "aethra_get_feedback",
    description:
      "Get the full details of a specific visual feedback annotation including " +
      "element context, bounding box, component tree, and resolution status.",
    inputSchema: {
      type: "object" as const,
      properties: {
        feedbackId: {
          type: "string",
          description: "Feedback item ID",
        },
      },
      required: ["feedbackId"],
    },
  },
  // ─── Agentation proxy tools (live annotations from toolbar) ────────────
  {
    name: "aethra_get_pending_annotations",
    description:
      "Get pending visual annotations from the Agentation toolbar. " +
      "Returns unacknowledged annotations with element selectors, comments, " +
      "severity, and UI context. Requires the Agentation server to be running.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "aethra_watch_annotations",
    description:
      "Block until new annotations arrive from the Agentation toolbar, then return them. " +
      "Collects annotations over a window (default 10s, max 60s) and returns the batch. " +
      "Use this for hands-free feedback processing loops.",
    inputSchema: {
      type: "object" as const,
      properties: {
        timeoutSeconds: {
          type: "number",
          description:
            "How long to wait for annotations (default: 10, max: 60)",
        },
      },
      required: [],
    },
  },
  {
    name: "aethra_resolve_annotation",
    description:
      "Mark an Agentation annotation as resolved. Call this after you have " +
      "implemented and verified the fix for the annotated issue.",
    inputSchema: {
      type: "object" as const,
      properties: {
        annotationId: {
          type: "string",
          description: "The annotation ID to resolve",
        },
        summary: {
          type: "string",
          description:
            "Brief description of what was done to resolve the issue",
        },
      },
      required: ["annotationId"],
    },
  },
  {
    name: "aethra_dismiss_annotation",
    description:
      "Dismiss an Agentation annotation with a reason. Use when the annotation " +
      "is not actionable, out of scope, or already addressed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        annotationId: {
          type: "string",
          description: "The annotation ID to dismiss",
        },
        reason: {
          type: "string",
          description: "Why this annotation is being dismissed",
        },
      },
      required: ["annotationId", "reason"],
    },
  },
  {
    name: "aethra_reply_annotation",
    description:
      "Reply to an Agentation annotation with a message. Use to ask for " +
      "clarification, provide status updates, or communicate with the reviewer.",
    inputSchema: {
      type: "object" as const,
      properties: {
        annotationId: {
          type: "string",
          description: "The annotation ID to reply to",
        },
        message: {
          type: "string",
          description: "The reply message",
        },
      },
      required: ["annotationId", "message"],
    },
  },

  // ─── Design intelligence tools ──────────────────────────────────────────────

  {
    name: "aethra_classify_task",
    description:
      "Classify a task description to determine if it requires a design workflow. " +
      "Returns classification (direct-fix, design-exploration, technical-illustration, " +
      "conventional-engineering), confidence score, and reasoning.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskDescription: {
          type: "string",
          description: "The task description to classify",
        },
      },
      required: ["taskDescription"],
    },
  },
  {
    name: "aethra_get_design_directions",
    description:
      "Get saved design directions for a task. Returns the array of design " +
      "directions with axes, positions, and rationale.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: {
          type: "string",
          description: "Task ID to load directions for",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "aethra_get_design_brief",
    description:
      "Get the design brief for a task. Returns aesthetic, composition, " +
      "hierarchy, typography, colors, anti-patterns, and responsive behavior.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: {
          type: "string",
          description: "Task ID to load the brief for",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "aethra_get_design_critique",
    description:
      "Get the latest design critique for a task. Returns scores across 10 " +
      "dimensions, overall score, strengths, improvements, and review status.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: {
          type: "string",
          description: "Task ID to load critique for",
        },
      },
      required: ["taskId"],
    },
  },
];

// ─── Tool handlers ────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const toolArgs = (args ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "aethra_get_client_config":
        return await handleGetClientConfig();

      case "aethra_get_client_facts":
        return await handleGetClientFacts();

      case "aethra_get_workspace_status":
        return await handleGetWorkspaceStatus();

      case "aethra_get_latest_audit":
        return await handleGetLatestAudit(
          toolArgs["type"] as string | undefined,
        );

      case "aethra_list_plans":
        return await handleListPlans(toolArgs["status"] as string | undefined);

      case "aethra_get_plan":
        return await handleGetPlan(toolArgs["planId"] as string);

      case "aethra_list_evidence":
        return await handleListEvidence();

      case "aethra_get_knowledge":
        return await handleGetKnowledge(toolArgs["filename"] as string);

      case "aethra_list_tasks":
        return await handleListTasks(toolArgs["status"] as string | undefined);

      case "aethra_get_task":
        return await handleGetTask(toolArgs["taskId"] as string);

      case "aethra_list_feedback":
        return await handleListFeedback(
          toolArgs["status"] as string | undefined,
          toolArgs["pageUrl"] as string | undefined,
        );

      case "aethra_get_feedback":
        return await handleGetFeedback(toolArgs["feedbackId"] as string);

      // Agentation proxy tools
      case "aethra_get_pending_annotations":
        return await handleGetPendingAnnotations();

      case "aethra_watch_annotations":
        return await handleWatchAnnotations(
          toolArgs["timeoutSeconds"] as number | undefined,
        );

      case "aethra_resolve_annotation":
        return await handleResolveAnnotation(
          toolArgs["annotationId"] as string,
          toolArgs["summary"] as string | undefined,
        );

      case "aethra_dismiss_annotation":
        return await handleDismissAnnotation(
          toolArgs["annotationId"] as string,
          toolArgs["reason"] as string,
        );

      case "aethra_reply_annotation":
        return await handleReplyAnnotation(
          toolArgs["annotationId"] as string,
          toolArgs["message"] as string,
        );

      case "aethra_classify_task":
        return await handleClassifyTask(toolArgs["taskDescription"] as string);

      case "aethra_get_design_directions":
        return await handleGetDesignDirections(toolArgs["taskId"] as string);

      case "aethra_get_design_brief":
        return await handleGetDesignBrief(toolArgs["taskId"] as string);

      case "aethra_get_design_critique":
        return await handleGetDesignCritique(toolArgs["taskId"] as string);

      default:
        return {
          content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    return {
      content: [
        { type: "text" as const, text: `Error: ${(err as Error).message}` },
      ],
      isError: true,
    };
  }
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleGetClientConfig() {
  const configPath = path.join(workspacePath, "client.yaml");
  if (!(await fs.pathExists(configPath))) {
    return errorResult(
      `client.yaml not found at ${workspacePath}. Is this an Aethra workspace?`,
    );
  }

  const raw = await fs.readFile(configPath, "utf8");
  const config = yaml.load(raw) as ClientConfig;

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(config, null, 2),
      },
    ],
  };
}

async function handleGetClientFacts() {
  const factsPath = path.join(workspacePath, "knowledge", "client-facts.md");
  if (!(await fs.pathExists(factsPath))) {
    return errorResult("client-facts.md not found in knowledge/");
  }

  const content = await fs.readFile(factsPath, "utf8");
  return { content: [{ type: "text" as const, text: content }] };
}

async function handleGetWorkspaceStatus() {
  const statePath = path.join(workspacePath, ".local", "workspace-state.json");
  if (!(await fs.pathExists(statePath))) {
    return errorResult(
      "workspace-state.json not found. Run aethra setup-client first.",
    );
  }

  const state = (await fs.readJson(statePath)) as WorkspaceState;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(state, null, 2) }],
  };
}

async function handleGetLatestAudit(type: string = "baseline") {
  const evidenceDir = path.join(workspacePath, "evidence");
  if (!(await fs.pathExists(evidenceDir))) {
    return errorResult(
      "evidence/ directory not found. Run aethra audit first.",
    );
  }

  // Find the most recent audit file matching the type
  const files = await fs.readdir(evidenceDir);
  const auditFiles = files
    .filter((f) => f.endsWith(".json") && f.includes(type))
    .sort()
    .reverse();

  if (auditFiles.length === 0) {
    return errorResult(`No ${type} audit found. Run: aethra audit`);
  }

  const auditPath = path.join(evidenceDir, auditFiles[0]!);
  const audit = (await fs.readJson(auditPath)) as AuditRun;

  // Return a summary (not the full object — it can be very large with screenshots)
  const summary = {
    id: audit.id,
    type: audit.type,
    status: audit.status,
    startedAt: audit.startedAt,
    completedAt: audit.completedAt,
    pagesInspected: audit.pagesInspected,
    findingsCount: audit.findings.length,
    findings: audit.findings,
    limitations: audit.limitations,
    errors: audit.errors,
    artifactCount: audit.artifactManifest.length,
    artifacts: audit.artifactManifest.map((a) => ({
      type: a.type,
      path: a.path,
      url: a.url,
    })),
    environment: audit.environment,
  };

  return {
    content: [
      { type: "text" as const, text: JSON.stringify(summary, null, 2) },
    ],
  };
}

async function handleListPlans(status?: string) {
  try {
    const db = getDb(workspacePath);
    const plans = dbListPlans(db, status ? { status } : undefined).map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      createdAt: p.createdAt,
      file: p.filePath,
    }));
    return {
      content: [
        { type: "text" as const, text: JSON.stringify({ plans }, null, 2) },
      ],
    };
  } catch {
    // Fallback to filesystem for workspaces not yet migrated
    const plansDir = path.join(workspacePath, "plans");
    if (!(await fs.pathExists(plansDir))) {
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ plans: [] }) },
        ],
      };
    }

    const files = await fs.readdir(plansDir);
    const planFiles = files.filter((f) => f.endsWith(".json"));
    const plans: Array<{
      id: string;
      title: string;
      status: string;
      createdAt: string;
      file: string;
    }> = [];

    for (const file of planFiles) {
      try {
        const plan = (await fs.readJson(
          path.join(plansDir, file),
        )) as ImplementationPlan;
        if (!status || plan.status === status) {
          plans.push({
            id: plan.id,
            title: plan.title,
            status: plan.status,
            createdAt: plan.createdAt,
            file,
          });
        }
      } catch {
        /* skip */
      }
    }

    plans.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      content: [
        { type: "text" as const, text: JSON.stringify({ plans }, null, 2) },
      ],
    };
  }
}

async function handleGetPlan(planId: string) {
  if (!planId) return errorResult("planId is required");

  const safePlanId = path.basename(planId);

  const plansDir = path.join(workspacePath, "plans");
  if (!(await fs.pathExists(plansDir))) {
    return errorResult("plans/ directory not found");
  }

  const files = await fs.readdir(plansDir);

  // Try exact filename match, then ID partial match
  const planFile =
    files.find((f) => f === safePlanId || f === `${safePlanId}.json`) ??
    files.find((f) => f.endsWith(".json") && f.includes(safePlanId));

  if (!planFile) {
    return errorResult(
      `Plan not found: ${safePlanId}. Use aethra_list_plans to see available plans.`,
    );
  }

  const plan = (await fs.readJson(
    path.join(plansDir, planFile),
  )) as ImplementationPlan;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(plan, null, 2) }],
  };
}

async function handleListEvidence() {
  const evidenceDir = path.join(workspacePath, "evidence");
  if (!(await fs.pathExists(evidenceDir))) {
    return {
      content: [
        { type: "text" as const, text: JSON.stringify({ artifacts: [] }) },
      ],
    };
  }

  const artifacts: Array<{
    name: string;
    type: string;
    size: number;
    modified: string;
  }> = [];

  async function scanDir(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else {
        const stat = await fs.stat(fullPath);
        const ext = path.extname(entry.name).toLowerCase();
        let type = "unknown";
        if (ext === ".png" || ext === ".jpg") type = "screenshot";
        else if (ext === ".json" && entry.name.includes("lighthouse"))
          type = "lighthouse";
        else if (ext === ".json") type = "audit-data";
        else if (ext === ".html") type = "report";

        artifacts.push({
          name: fullPath.replace(workspacePath + "/", ""),
          type,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        });
      }
    }
  }

  await scanDir(evidenceDir);
  artifacts.sort((a, b) => b.modified.localeCompare(a.modified));

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ artifacts, total: artifacts.length }, null, 2),
      },
    ],
  };
}

async function handleGetKnowledge(filename: string) {
  if (!filename) return errorResult("filename is required");

  // Security: only allow access within knowledge/ directory, no path traversal
  const safeName = path.basename(filename);
  const knowledgePath = path.join(workspacePath, "knowledge", safeName);

  if (!(await fs.pathExists(knowledgePath))) {
    // List available files to help
    const knowledgeDir = path.join(workspacePath, "knowledge");
    let available: string[] = [];
    if (await fs.pathExists(knowledgeDir)) {
      available = await fs.readdir(knowledgeDir);
    }
    return errorResult(
      `Knowledge file not found: ${safeName}. Available: ${available.join(", ") || "none"}`,
    );
  }

  const content = await fs.readFile(knowledgePath, "utf8");
  return { content: [{ type: "text" as const, text: content }] };
}

async function handleListTasks(status?: string) {
  try {
    const db = getDb(workspacePath);
    const tasks = dbListTasks(db, status ? { status } : undefined).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      planId: t.planId,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
    return {
      content: [
        { type: "text" as const, text: JSON.stringify({ tasks }, null, 2) },
      ],
    };
  } catch {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ tasks: [] }) }],
    };
  }
}

async function handleGetTask(taskId: string) {
  if (!taskId) return errorResult("taskId is required");

  const db = getDb(workspacePath);
  const task = dbFindTaskByPrefix(db, taskId) ?? dbLoadTask(db, taskId);
  if (!task) {
    return errorResult(
      `Task not found: ${taskId}. Use aethra_list_tasks to see available tasks.`,
    );
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function handleListFeedback(status?: string, pageUrl?: string) {
  try {
    const db = getDb(workspacePath);
    const filters: { status?: string; pageUrl?: string } = {};
    if (status) filters.status = status;
    if (pageUrl) filters.pageUrl = pageUrl;

    const items = dbListFeedback(
      db,
      Object.keys(filters).length > 0 ? filters : undefined,
    ).map((f) => ({
      id: f.id,
      comment: f.comment,
      status: f.status,
      kind: f.kind,
      severity: f.severity,
      pageUrl: f.pageUrl,
      elementSelector: f.elementSelector,
      createdAt: f.createdAt,
    }));
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ feedback: items }, null, 2),
        },
      ],
    };
  } catch {
    return {
      content: [
        { type: "text" as const, text: JSON.stringify({ feedback: [] }) },
      ],
    };
  }
}

async function handleGetFeedback(feedbackId: string) {
  if (!feedbackId) return errorResult("feedbackId is required");

  const db = getDb(workspacePath);
  const feedback = dbLoadFeedback(db, feedbackId);
  if (!feedback) {
    return errorResult(
      `Feedback not found: ${feedbackId}. Use aethra_list_feedback to see available items.`,
    );
  }

  return {
    content: [
      { type: "text" as const, text: JSON.stringify(feedback, null, 2) },
    ],
  };
}

// ─── Agentation proxy handlers ───────────────────────────────────────────────

const AGENTATION_PORT = 4747;
const AGENTATION_BASE = `http://localhost:${AGENTATION_PORT}`;

/**
 * Ensure the Agentation HTTP server is running.
 * Delegates to the AgentationProvider to maintain a single lifecycle owner.
 */
async function ensureAgentationServer(): Promise<boolean> {
  // Check if already running
  try {
    const res = await fetch(`${AGENTATION_BASE}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) return true;
  } catch {
    // Not running
  }

  // Start via the provider (single lifecycle owner)
  try {
    const { getProvider } =
      await import("../visual-feedback/providers/registry.js");
    const provider = getProvider("agentation");
    if (provider && "startServer" in provider) {
      await (
        provider as { startServer: (port?: number) => Promise<void> }
      ).startServer(AGENTATION_PORT);
      return true;
    }
  } catch {
    // Fall through
  }

  // Direct fallback if provider not available
  try {
    const { startHttpServer } = await import("agentation-mcp");
    startHttpServer(AGENTATION_PORT);
    process.stderr.write(
      `Agentation server started on port ${AGENTATION_PORT}\n`,
    );
    return true;
  } catch (err) {
    process.stderr.write(
      `Could not start Agentation server: ${(err as Error).message}\n`,
    );
    return false;
  }
}

/** Get the client slug for this workspace and its mapped Agentation sessions. */
function getWorkspaceSessionScope(): {
  clientSlug: string;
  mappedSessions: string[];
} {
  let clientSlug = "unknown";
  try {
    const configPath = path.join(workspacePath, "client.yaml");
    const raw = fs.readFileSync(configPath, "utf8");
    const config = yaml.load(raw) as ClientConfig;
    clientSlug = config.slug;
  } catch {
    // Fall through with unknown
  }

  const db = getDb(workspacePath);
  const mappedSessions = dbGetSessionsForClient(db, clientSlug);
  return { clientSlug, mappedSessions };
}

/** Fetch pending annotations only from sessions mapped to this workspace. */
async function fetchScopedPendingAnnotations(): Promise<unknown[]> {
  const { mappedSessions } = getWorkspaceSessionScope();

  if (mappedSessions.length === 0) {
    return [];
  }

  const allPending: unknown[] = [];
  for (const sessionId of mappedSessions) {
    try {
      const res = await fetch(
        `${AGENTATION_BASE}/sessions/${sessionId}/pending`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (!res.ok) continue;
      const annotations = await res.json();
      if (Array.isArray(annotations)) {
        allPending.push(
          ...annotations.map((a: Record<string, unknown>) => ({
            ...a,
            sessionId,
          })),
        );
      }
    } catch {
      // Skip failing sessions
    }
  }
  return allPending;
}

async function handleGetPendingAnnotations() {
  if (!(await ensureAgentationServer())) {
    return errorResult(
      "Agentation server not available. Install agentation-mcp or check configuration.",
    );
  }

  const { mappedSessions } = getWorkspaceSessionScope();
  if (mappedSessions.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              annotations: [],
              count: 0,
              note: "No sessions mapped to this workspace. Use 'aethra feedback watch' to create a session.",
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  try {
    const allPending = await fetchScopedPendingAnnotations();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { annotations: allPending, count: allPending.length },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    return errorResult(
      `Failed to get pending annotations: ${(err as Error).message}`,
    );
  }
}

async function handleWatchAnnotations(timeoutSeconds?: number) {
  if (!(await ensureAgentationServer())) {
    return errorResult("Agentation server not available.");
  }

  const { mappedSessions } = getWorkspaceSessionScope();
  if (mappedSessions.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              annotations: [],
              count: 0,
              waitedSeconds: 0,
              note: "No sessions mapped to this workspace.",
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  const timeout = Math.min(Math.max(timeoutSeconds ?? 10, 1), 60);

  try {
    const startTime = Date.now();
    const collected: unknown[] = [];
    const seenIds = new Set<string>();

    while (Date.now() - startTime < timeout * 1000) {
      for (const sessionId of mappedSessions) {
        try {
          const res = await fetch(
            `${AGENTATION_BASE}/sessions/${sessionId}/pending`,
            { signal: AbortSignal.timeout(3000) },
          );
          if (!res.ok) continue;
          const annotations = (await res.json()) as Array<
            Record<string, unknown>
          >;
          for (const ann of annotations) {
            const id = String(ann.id ?? "");
            if (id && !seenIds.has(id)) {
              seenIds.add(id);
              collected.push({ ...ann, sessionId });
            }
          }
        } catch {
          // Skip
        }
      }

      if (collected.length > 0) break;
      await new Promise((r) => setTimeout(r, 2000));
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              annotations: collected,
              count: collected.length,
              waitedSeconds: Math.round((Date.now() - startTime) / 1000),
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    return errorResult(`Watch failed: ${(err as Error).message}`);
  }
}

async function handleResolveAnnotation(annotationId: string, summary?: string) {
  if (!annotationId) return errorResult("annotationId is required");
  if (!(await ensureAgentationServer())) {
    return errorResult("Agentation server not available.");
  }

  try {
    const res = await fetch(`${AGENTATION_BASE}/annotations/${annotationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isFixed: true,
        resolution: summary ?? "Resolved",
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return errorResult(
        `Failed to resolve annotation ${annotationId}: ${res.status}`,
      );
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Annotation ${annotationId} resolved.${summary ? ` Summary: ${summary}` : ""}`,
        },
      ],
    };
  } catch (err) {
    return errorResult(
      `Failed to resolve annotation: ${(err as Error).message}`,
    );
  }
}

async function handleDismissAnnotation(annotationId: string, reason: string) {
  if (!annotationId) return errorResult("annotationId is required");
  if (!(await ensureAgentationServer())) {
    return errorResult("Agentation server not available.");
  }

  try {
    const res = await fetch(`${AGENTATION_BASE}/annotations/${annotationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dismissed: true, dismissReason: reason }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return errorResult(
        `Failed to dismiss annotation ${annotationId}: ${res.status}`,
      );
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Annotation ${annotationId} dismissed. Reason: ${reason}`,
        },
      ],
    };
  } catch (err) {
    return errorResult(
      `Failed to dismiss annotation: ${(err as Error).message}`,
    );
  }
}

async function handleReplyAnnotation(annotationId: string, message: string) {
  if (!annotationId) return errorResult("annotationId is required");
  if (!message) return errorResult("message is required");
  if (!(await ensureAgentationServer())) {
    return errorResult("Agentation server not available.");
  }

  try {
    const res = await fetch(
      `${AGENTATION_BASE}/annotations/${annotationId}/thread`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, role: "agent" }),
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!res.ok) {
      return errorResult(
        `Failed to reply to annotation ${annotationId}: ${res.status}`,
      );
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Reply sent to annotation ${annotationId}.`,
        },
      ],
    };
  } catch (err) {
    return errorResult(
      `Failed to reply to annotation: ${(err as Error).message}`,
    );
  }
}

// ─── Design intelligence handlers ────────────────────────────────────────────

async function handleClassifyTask(taskDescription: string) {
  if (!taskDescription) return errorResult("taskDescription is required");

  const { classifyTask } = await import("../design/task-classifier.js");
  const result = classifyTask(taskDescription);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

async function handleGetDesignDirections(taskId: string) {
  if (!taskId) return errorResult("taskId is required");

  const { loadDesignDirections } =
    await import("../design/direction-planner.js");
  const directions = await loadDesignDirections(workspacePath, taskId);
  if (!directions) {
    return errorResult(
      `No design directions found for task ${taskId}. Run 'aethra design directions' first.`,
    );
  }
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(directions, null, 2) },
    ],
  };
}

async function handleGetDesignBrief(taskId: string) {
  if (!taskId) return errorResult("taskId is required");

  const { loadDesignBrief } = await import("../design/design-brief.js");
  const brief = await loadDesignBrief(workspacePath, taskId);
  if (!brief) {
    return errorResult(
      `No design brief found for task ${taskId}. Run 'aethra design brief' first.`,
    );
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(brief, null, 2) }],
  };
}

async function handleGetDesignCritique(taskId: string) {
  if (!taskId) return errorResult("taskId is required");

  const { loadCritique } = await import("../design/critic.js");
  const critique = await loadCritique(workspacePath, taskId);
  if (!critique) {
    return errorResult(
      `No design critique found for task ${taskId}. Run 'aethra design critique' first.`,
    );
  }
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(critique, null, 2) },
    ],
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

// ─── Resource handlers (Agentation push notifications) ───────────────────────

const PENDING_ANNOTATIONS_URI = "aethra://annotations/pending";

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: PENDING_ANNOTATIONS_URI,
      name: "Pending Annotations",
      description:
        "Live visual feedback annotations from the Agentation toolbar. " +
        "Subscribe to this resource to be notified when new annotations arrive.",
      mimeType: "application/json",
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === PENDING_ANNOTATIONS_URI) {
    if (!(await ensureAgentationServer())) {
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify({
              annotations: [],
              error: "Agentation server not available",
            }),
          },
        ],
      };
    }

    try {
      const allPending = await fetchScopedPendingAnnotations();
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify({
              annotations: allPending,
              count: allPending.length,
            }),
          },
        ],
      };
    } catch {
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify({ annotations: [] }),
          },
        ],
      };
    }
  }

  return {
    contents: [
      { uri, mimeType: "text/plain", text: `Unknown resource: ${uri}` },
    ],
  };
});

server.setRequestHandler(SubscribeRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === PENDING_ANNOTATIONS_URI) {
    // Start the Agentation SSE bridge when a client subscribes
    await startSseBridge();
  }

  return {};
});

// ─── SSE bridge: Agentation events → MCP resource notifications ──────────────

let sseBridgeActive = false;
let sseBridgeAbort: AbortController | null = null;

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

async function startSseBridge(): Promise<void> {
  if (sseBridgeActive) return;
  if (!(await ensureAgentationServer())) return;

  sseBridgeActive = true;
  sseBridgeAbort = new AbortController();

  const runBridge = async () => {
    let backoffMs = 1000;
    const MAX_BACKOFF = 30_000;

    while (sseBridgeActive && !sseBridgeAbort!.signal.aborted) {
      try {
        const res = await fetch(`${AGENTATION_BASE}/events`, {
          headers: { Accept: "text/event-stream" },
          signal: sseBridgeAbort!.signal,
        });

        if (!res.ok || !res.body) {
          process.stderr.write(
            `Agentation SSE: failed to connect (${res.status}), retrying in ${backoffMs}ms\n`,
          );
          await abortableSleep(backoffMs, sseBridgeAbort!.signal);
          backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);
          continue;
        }

        // Connected — reset backoff
        backoffMs = 1000;
        process.stderr.write(
          "Agentation SSE bridge active — annotations will push to agent\n",
        );

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6));
                if (
                  event.type === "annotation.created" ||
                  event.type === "annotation.updated"
                ) {
                  await server.sendResourceUpdated({
                    uri: PENDING_ANNOTATIONS_URI,
                  });
                }
              } catch {
                // Skip malformed SSE data
              }
            }
          }
        }

        // Stream ended normally — reconnect
        process.stderr.write("Agentation SSE: stream ended, reconnecting...\n");
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          break; // Intentional shutdown
        }
        process.stderr.write(
          `Agentation SSE bridge error: ${(err as Error).message}, retrying in ${backoffMs}ms\n`,
        );
      }

      // Wait before reconnecting
      try {
        await abortableSleep(backoffMs, sseBridgeAbort!.signal);
      } catch {
        break; // Aborted during sleep
      }
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);
    }

    sseBridgeActive = false;
  };

  // Run in background — don't await
  runBridge();
}

// ─── Start server ─────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server is now listening on stdio — no console.log (would corrupt the stream)
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
