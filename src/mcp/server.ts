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
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import path from "path";
import fs from "fs-extra";
import yaml from "js-yaml";
import type {
  ClientConfig,
  WorkspaceState,
  ImplementationPlan,
  AuditRun,
} from "../core/schemas.js";

// ─── Server setup ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: "aethra", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

// Workspace path — resolved from CLI arg or environment
const workspacePath =
  process.argv[2] ?? process.env["AETHRA_WORKSPACE"] ?? process.cwd();

// Validate workspace at startup
const configCheckPath = path.join(workspacePath, "client.yaml");
fs.pathExists(configCheckPath).then((exists) => {
  if (!exists) {
    process.stderr.write(
      `Warning: ${workspacePath} does not appear to be an Aethra workspace (no client.yaml found).\n`,
    );
  }
});

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
  const plansDir = path.join(workspacePath, "plans");
  if (!(await fs.pathExists(plansDir))) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ plans: [] }) }],
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
      // Skip malformed plan files
    }
  }

  plans.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    content: [
      { type: "text" as const, text: JSON.stringify({ plans }, null, 2) },
    ],
  };
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
  const tasksRoot = path.join(workspacePath, "tasks");
  if (!(await fs.pathExists(tasksRoot))) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ tasks: [] }) }],
    };
  }

  const entries = await fs.readdir(tasksRoot);
  const tasks: Array<{
    id: string;
    title: string;
    status: string;
    planId: string;
    createdAt: string;
    updatedAt: string;
  }> = [];

  for (const entry of entries) {
    const fp = path.join(tasksRoot, entry, "task.yaml");
    if (!(await fs.pathExists(fp))) continue;
    try {
      const raw = await fs.readJson(fp);
      if (!status || raw.status === status) {
        tasks.push({
          id: raw.id,
          title: raw.title,
          status: raw.status,
          planId: raw.planId,
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt,
        });
      }
    } catch {
      // Skip malformed task files
    }
  }

  tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    content: [
      { type: "text" as const, text: JSON.stringify({ tasks }, null, 2) },
    ],
  };
}

async function handleGetTask(taskId: string) {
  if (!taskId) return errorResult("taskId is required");

  const safeId = path.basename(taskId);
  const tasksRoot = path.join(workspacePath, "tasks");
  if (!(await fs.pathExists(tasksRoot))) {
    return errorResult("tasks/ directory not found");
  }

  const entries = await fs.readdir(tasksRoot);
  // Find by exact match or prefix match
  const taskDir = entries.find((e) => e === safeId || e.startsWith(safeId));
  if (!taskDir) {
    return errorResult(
      `Task not found: ${safeId}. Use aethra_list_tasks to see available tasks.`,
    );
  }

  const fp = path.join(tasksRoot, taskDir, "task.yaml");
  if (!(await fs.pathExists(fp))) {
    return errorResult(`Task file not found for: ${taskDir}`);
  }

  const task = await fs.readJson(fp);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function handleListFeedback(status?: string, pageUrl?: string) {
  const feedbackDir = path.join(workspacePath, "feedback", "items");
  if (!(await fs.pathExists(feedbackDir))) {
    return {
      content: [
        { type: "text" as const, text: JSON.stringify({ feedback: [] }) },
      ],
    };
  }

  const entries = await fs.readdir(feedbackDir);
  const items: Array<{
    id: string;
    comment: string;
    status: string;
    kind: string;
    severity: string;
    pageUrl: string;
    elementSelector?: string;
    createdAt: string;
  }> = [];

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const raw = await fs.readJson(path.join(feedbackDir, entry));
      if (status && raw.status !== status) continue;
      if (pageUrl && raw.pageUrl !== pageUrl) continue;
      items.push({
        id: raw.id,
        comment: raw.comment,
        status: raw.status,
        kind: raw.kind,
        severity: raw.severity,
        pageUrl: raw.pageUrl,
        elementSelector: raw.elementSelector,
        createdAt: raw.createdAt,
      });
    } catch {
      // Skip malformed feedback files
    }
  }

  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ feedback: items }, null, 2),
      },
    ],
  };
}

async function handleGetFeedback(feedbackId: string) {
  if (!feedbackId) return errorResult("feedbackId is required");

  const safeFeedbackId = path.basename(feedbackId).replace(/\.json$/, "");
  const fp = path.join(
    workspacePath,
    "feedback",
    "items",
    `${safeFeedbackId}.json`,
  );

  if (!(await fs.pathExists(fp))) {
    return errorResult(
      `Feedback not found: ${safeFeedbackId}. Use aethra_list_feedback to see available items.`,
    );
  }

  const feedback = await fs.readJson(fp);
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(feedback, null, 2) },
    ],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
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
