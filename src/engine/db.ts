/**
 * SQLite database module for Aethra operational data.
 *
 * Provides indexed storage for tasks, feedback, audit runs, findings, and plans.
 * Uses better-sqlite3 for synchronous, fast, single-file persistence.
 *
 * Database location: <workspace>/.local/aethra.db
 * Test databases use :memory: for isolation.
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs-extra";
import { logger } from "../core/logger.js";
import { VisualFeedbackError } from "../core/errors.js";
import {
  claimSessionOwnership,
  releaseSessionOwnership,
  closeGlobalRegistry,
  syncLegacySessionMappings,
  normalizeWorkspacePath,
} from "./session-registry.js";
export {
  claimSessionOwnership,
  releaseSessionOwnership,
  getGlobalSessionOwner,
  setGlobalRegistryPath,
  clearGlobalRegistry,
  closeGlobalRegistry,
  verifySessionAuthorization,
  normalizeWorkspacePath,
} from "./session-registry.js";
import type {
  TaskRecord,
  Finding,
  ImplementationPlan,
  AuditRun,
} from "../core/schemas.js";
import type {
  VisualFeedback,
  FeedbackSession,
} from "../visual-feedback/schema.js";

// ─── Database lifecycle ──────────────────────────────────────────────────────

const dbCache = new Map<string, Database.Database>();

/** Get or create a database for a workspace. */
export function getDb(workspacePath: string): Database.Database {
  const cached = dbCache.get(workspacePath);
  if (cached) return cached;

  const localDir = path.join(workspacePath, ".local");
  fs.ensureDirSync(localDir);
  const dbPath = path.join(localDir, "aethra.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  syncLegacySessionMappings(db, workspacePath);
  dbCache.set(workspacePath, db);
  return db;
}

/** Get an in-memory database for testing. */
export function getTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

/** Close a specific workspace database. */
export function closeDb(workspacePath: string): void {
  const db = dbCache.get(workspacePath);
  if (db) {
    db.close();
    dbCache.delete(workspacePath);
  }
}

/** Close all open databases. */
export function closeAllDbs(): void {
  for (const [key, db] of dbCache) {
    db.close();
    dbCache.delete(key);
  }
  closeGlobalRegistry();
}

// ─── Migrations ──────────────────────────────────────────────────────────────

const MIGRATIONS: Array<{ version: number; description: string; sql: string }> =
  [
    {
      version: 1,
      description:
        "Initial schema: tasks, feedback, sessions, audit_runs, findings, plans",
      sql: `
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        client_slug TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'planned',
        plan_id TEXT NOT NULL,
        plan_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        approved_by TEXT,
        approved_at TEXT,
        started_at TEXT,
        completed_at TEXT,
        git_branch TEXT,
        verification_id TEXT,
        notes TEXT,
        feedback_ids TEXT DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);

      CREATE TABLE IF NOT EXISTS feedback_items (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_annotation_id TEXT,
        client_id TEXT NOT NULL,
        project_id TEXT,
        task_id TEXT,
        session_id TEXT,
        page_url TEXT NOT NULL,
        viewport_width INTEGER,
        viewport_height INTEGER,
        viewport_scale REAL,
        comment TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'other',
        intent TEXT NOT NULL DEFAULT 'investigate',
        severity TEXT NOT NULL DEFAULT 'medium',
        element_tag TEXT,
        element_selector TEXT,
        bounding_box TEXT,
        source_file TEXT,
        component_tree TEXT,
        css_classes TEXT,
        computed_styles TEXT,
        accessibility_context TEXT,
        nearby_text TEXT,
        screenshot_reference TEXT,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        resolution_summary TEXT,
        related_finding_ids TEXT DEFAULT '[]',
        related_feedback_ids TEXT DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback_items(status);
      CREATE INDEX IF NOT EXISTS idx_feedback_page_url ON feedback_items(page_url);
      CREATE INDEX IF NOT EXISTS idx_feedback_task_id ON feedback_items(task_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback_items(created_at);

      CREATE TABLE IF NOT EXISTS feedback_sessions (
        id TEXT PRIMARY KEY,
        client_slug TEXT NOT NULL,
        provider TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        page_urls TEXT DEFAULT '[]',
        feedback_ids TEXT DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        reviewer_name TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_runs (
        id TEXT PRIMARY KEY,
        client_slug TEXT NOT NULL,
        type TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT NOT NULL,
        target_url TEXT,
        pages_inspected TEXT DEFAULT '[]',
        errors TEXT DEFAULT '[]',
        limitations TEXT DEFAULT '[]',
        environment TEXT NOT NULL,
        artifact_manifest TEXT DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_audit_type_client ON audit_runs(type, client_slug);
      CREATE INDEX IF NOT EXISTS idx_audit_started ON audit_runs(started_at);

      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        audit_run_id TEXT NOT NULL,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'observed',
        evidence TEXT DEFAULT '[]',
        confidence REAL,
        recommendation TEXT,
        verification_required INTEGER DEFAULT 1,
        url TEXT,
        viewport TEXT,
        created_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_findings_audit ON findings(audit_run_id);
      CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
      CREATE INDEX IF NOT EXISTS idx_findings_category ON findings(category);

      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        client_slug TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        estimated_scope TEXT,
        file_path TEXT,
        feedback_ids TEXT DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
    `,
    },
    {
      version: 2,
      description: "Idempotent imports, provider metadata, session mappings",
      sql: `
    DELETE FROM feedback_items
    WHERE rowid NOT IN (
      SELECT MAX(rowid) FROM feedback_items
      WHERE provider_annotation_id IS NOT NULL
      GROUP BY provider, provider_annotation_id, client_id
    ) AND provider_annotation_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_provider_dedup
      ON feedback_items(provider, provider_annotation_id, client_id)
      WHERE provider_annotation_id IS NOT NULL;

    ALTER TABLE feedback_items ADD COLUMN provider_metadata TEXT DEFAULT NULL;

    CREATE TABLE IF NOT EXISTS session_mappings (
      agentation_session_id TEXT NOT NULL,
      client_slug TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (agentation_session_id, client_slug)
    );
    CREATE INDEX IF NOT EXISTS idx_session_mappings_client
      ON session_mappings(client_slug);
  `,
    },
    {
      version: 3,
      description: "Enforce unique session ownership across client workspaces",
      sql: `
    DELETE FROM session_mappings
    WHERE rowid NOT IN (
      SELECT MAX(rowid) FROM session_mappings
      GROUP BY agentation_session_id
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_session_mappings_unique_session
      ON session_mappings(agentation_session_id);
  `,
    },
  ];

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT
    );
  `);

  const applied = db
    .prepare("SELECT MAX(version) AS v FROM _migrations")
    .get() as { v: number | null };
  const currentVersion = applied?.v ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;
    const tx = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(
        "INSERT INTO _migrations (version, applied_at, description) VALUES (?, ?, ?)",
      ).run(migration.version, new Date().toISOString(), migration.description);
    });
    tx();
    logger.debug(`Migration ${migration.version}: ${migration.description}`);
  }
}

// ─── Row mappers ─────────────────────────────────────────────────────────────

function jsonParse<T>(val: unknown, fallback: T): T {
  if (val === null || val === undefined) return fallback;
  if (typeof val !== "string") return fallback;
  try {
    return JSON.parse(val) as T;
  } catch {
    return fallback;
  }
}

// Task mappers
interface TaskRow {
  id: string;
  title: string;
  client_slug: string;
  status: string;
  plan_id: string;
  plan_path: string;
  created_at: string;
  updated_at: string;
  approved_by: string | null;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  git_branch: string | null;
  verification_id: string | null;
  notes: string | null;
  feedback_ids: string;
}

function rowToTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    title: row.title,
    clientSlug: row.client_slug,
    status: row.status as TaskRecord["status"],
    planId: row.plan_id,
    planPath: row.plan_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedBy: row.approved_by ?? undefined,
    approvedAt: row.approved_at ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    gitBranch: row.git_branch ?? undefined,
    verificationId: row.verification_id ?? undefined,
    notes: row.notes ?? undefined,
    feedbackIds: jsonParse(row.feedback_ids, []),
  };
}

function taskToRow(task: TaskRecord): TaskRow {
  return {
    id: task.id,
    title: task.title,
    client_slug: task.clientSlug,
    status: task.status,
    plan_id: task.planId,
    plan_path: task.planPath,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    approved_by: task.approvedBy ?? null,
    approved_at: task.approvedAt ?? null,
    started_at: task.startedAt ?? null,
    completed_at: task.completedAt ?? null,
    git_branch: task.gitBranch ?? null,
    verification_id: task.verificationId ?? null,
    notes: task.notes ?? null,
    feedback_ids: JSON.stringify(task.feedbackIds ?? []),
  };
}

// Feedback mappers
interface FeedbackRow {
  id: string;
  provider: string;
  provider_annotation_id: string | null;
  client_id: string;
  project_id: string | null;
  task_id: string | null;
  session_id: string | null;
  page_url: string;
  viewport_width: number | null;
  viewport_height: number | null;
  viewport_scale: number | null;
  comment: string;
  kind: string;
  intent: string;
  severity: string;
  element_tag: string | null;
  element_selector: string | null;
  bounding_box: string | null;
  source_file: string | null;
  component_tree: string | null;
  css_classes: string | null;
  computed_styles: string | null;
  accessibility_context: string | null;
  nearby_text: string | null;
  screenshot_reference: string | null;
  provider_metadata: string | null;
  created_at: string;
  status: string;
  resolution_summary: string | null;
  related_finding_ids: string;
  related_feedback_ids: string;
}

function rowToFeedback(row: FeedbackRow): VisualFeedback {
  return {
    id: row.id,
    provider: row.provider,
    providerAnnotationId: row.provider_annotation_id ?? undefined,
    clientId: row.client_id,
    projectId: row.project_id ?? undefined,
    taskId: row.task_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    pageUrl: row.page_url,
    viewport:
      row.viewport_width != null && row.viewport_height != null
        ? {
          width: row.viewport_width,
          height: row.viewport_height,
          deviceScaleFactor: row.viewport_scale ?? undefined,
        }
        : undefined,
    comment: row.comment,
    kind: row.kind as VisualFeedback["kind"],
    intent: row.intent as VisualFeedback["intent"],
    severity: row.severity as VisualFeedback["severity"],
    elementTag: row.element_tag ?? undefined,
    elementSelector: row.element_selector ?? undefined,
    boundingBox: jsonParse(row.bounding_box, undefined),
    sourceFile: row.source_file ?? undefined,
    componentTree: jsonParse(row.component_tree, undefined),
    cssClasses: jsonParse(row.css_classes, undefined),
    computedStyles: jsonParse(row.computed_styles, undefined),
    accessibilityContext: jsonParse(row.accessibility_context, undefined),
    nearbyText: row.nearby_text ?? undefined,
    screenshotReference: row.screenshot_reference ?? undefined,
    providerMetadata: jsonParse(row.provider_metadata, undefined),
    createdAt: row.created_at,
    status: row.status as VisualFeedback["status"],
    resolutionSummary: row.resolution_summary ?? undefined,
    relatedFindingIds: jsonParse(row.related_finding_ids, []),
    relatedFeedbackIds: jsonParse(row.related_feedback_ids, []),
  };
}

function feedbackToRow(fb: VisualFeedback): FeedbackRow {
  return {
    id: fb.id,
    provider: fb.provider,
    provider_annotation_id: fb.providerAnnotationId ?? null,
    client_id: fb.clientId,
    project_id: fb.projectId ?? null,
    task_id: fb.taskId ?? null,
    session_id: fb.sessionId ?? null,
    page_url: fb.pageUrl,
    viewport_width: fb.viewport?.width ?? null,
    viewport_height: fb.viewport?.height ?? null,
    viewport_scale: fb.viewport?.deviceScaleFactor ?? null,
    comment: fb.comment,
    kind: fb.kind,
    intent: fb.intent,
    severity: fb.severity,
    element_tag: fb.elementTag ?? null,
    element_selector: fb.elementSelector ?? null,
    bounding_box: fb.boundingBox ? JSON.stringify(fb.boundingBox) : null,
    source_file: fb.sourceFile ?? null,
    component_tree: fb.componentTree ? JSON.stringify(fb.componentTree) : null,
    css_classes: fb.cssClasses ? JSON.stringify(fb.cssClasses) : null,
    computed_styles: fb.computedStyles
      ? JSON.stringify(fb.computedStyles)
      : null,
    accessibility_context: fb.accessibilityContext
      ? JSON.stringify(fb.accessibilityContext)
      : null,
    nearby_text: fb.nearbyText ?? null,
    screenshot_reference: fb.screenshotReference ?? null,
    provider_metadata: fb.providerMetadata
      ? JSON.stringify(fb.providerMetadata)
      : null,
    created_at: fb.createdAt,
    status: fb.status,
    resolution_summary: fb.resolutionSummary ?? null,
    related_finding_ids: JSON.stringify(fb.relatedFindingIds ?? []),
    related_feedback_ids: JSON.stringify(fb.relatedFeedbackIds ?? []),
  };
}

// Session mapper
interface SessionRow {
  id: string;
  client_slug: string;
  provider: string;
  started_at: string;
  ended_at: string | null;
  page_urls: string;
  feedback_ids: string;
  status: string;
  reviewer_name: string | null;
}

function rowToSession(row: SessionRow): FeedbackSession {
  return {
    id: row.id,
    clientSlug: row.client_slug,
    provider: row.provider,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    pageUrls: jsonParse(row.page_urls, []),
    feedbackIds: jsonParse(row.feedback_ids, []),
    status: row.status as FeedbackSession["status"],
    reviewerName: row.reviewer_name ?? undefined,
  };
}

function sessionToRow(s: FeedbackSession): SessionRow {
  return {
    id: s.id,
    client_slug: s.clientSlug,
    provider: s.provider,
    started_at: s.startedAt,
    ended_at: s.endedAt ?? null,
    page_urls: JSON.stringify(s.pageUrls ?? []),
    feedback_ids: JSON.stringify(s.feedbackIds ?? []),
    status: s.status,
    reviewer_name: s.reviewerName ?? null,
  };
}

// ─── Task CRUD ───────────────────────────────────────────────────────────────

export function dbCreateTask(db: Database.Database, task: TaskRecord): void {
  const row = taskToRow(task);
  db.prepare(
    `
    INSERT INTO tasks (id, title, client_slug, status, plan_id, plan_path,
      created_at, updated_at, approved_by, approved_at, started_at, completed_at,
      git_branch, verification_id, notes, feedback_ids)
    VALUES (@id, @title, @client_slug, @status, @plan_id, @plan_path,
      @created_at, @updated_at, @approved_by, @approved_at, @started_at, @completed_at,
      @git_branch, @verification_id, @notes, @feedback_ids)
  `,
  ).run(row);
}

export function dbLoadTask(
  db: Database.Database,
  taskId: string,
): TaskRecord | null {
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as
    | TaskRow
    | undefined;
  return row ? rowToTask(row) : null;
}

export function dbSaveTask(db: Database.Database, task: TaskRecord): void {
  const row = taskToRow(task);
  db.prepare(
    `
    INSERT OR REPLACE INTO tasks (id, title, client_slug, status, plan_id, plan_path,
      created_at, updated_at, approved_by, approved_at, started_at, completed_at,
      git_branch, verification_id, notes, feedback_ids)
    VALUES (@id, @title, @client_slug, @status, @plan_id, @plan_path,
      @created_at, @updated_at, @approved_by, @approved_at, @started_at, @completed_at,
      @git_branch, @verification_id, @notes, @feedback_ids)
  `,
  ).run(row);
}

export function dbListTasks(
  db: Database.Database,
  filters?: { status?: string; clientSlug?: string },
): TaskRecord[] {
  let sql = "SELECT * FROM tasks";
  const conditions: string[] = [];
  const params: Record<string, string> = {};

  if (filters?.status) {
    conditions.push("status = @status");
    params.status = filters.status;
  }
  if (filters?.clientSlug) {
    conditions.push("client_slug = @clientSlug");
    params.clientSlug = filters.clientSlug;
  }

  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY created_at DESC";

  const rows = db.prepare(sql).all(params) as TaskRow[];
  return rows.map(rowToTask);
}

export function dbFindTaskByPrefix(
  db: Database.Database,
  prefix: string,
): TaskRecord | null {
  // Try exact match first, then prefix
  const exact = db.prepare("SELECT * FROM tasks WHERE id = ?").get(prefix) as
    | TaskRow
    | undefined;
  if (exact) return rowToTask(exact);

  const prefixed = db
    .prepare("SELECT * FROM tasks WHERE id LIKE ? LIMIT 1")
    .get(prefix + "%") as TaskRow | undefined;
  return prefixed ? rowToTask(prefixed) : null;
}

// ─── Feedback CRUD ───────────────────────────────────────────────────────────

export function dbSaveFeedback(
  db: Database.Database,
  feedback: VisualFeedback,
): void {
  const row = feedbackToRow(feedback);
  db.transaction(() => {
    // If an item already exists with the same (provider, provider_annotation_id, client_id),
    // ensure we reuse its existing primary key ID so ON CONFLICT(id) triggers smoothly
    if (feedback.providerAnnotationId) {
      const existing = dbFindFeedbackByProviderAnnotation(
        db,
        feedback.provider,
        feedback.providerAnnotationId,
        feedback.clientId,
      );
      if (existing) {
        row.id = existing.id;
        feedback.id = existing.id;
      }
    }

    db.prepare(
      `
      INSERT INTO feedback_items (
        id, provider, provider_annotation_id, client_id, project_id, task_id, session_id,
        page_url, viewport_width, viewport_height, viewport_scale,
        comment, kind, intent, severity,
        element_tag, element_selector, bounding_box, source_file,
        component_tree, css_classes, computed_styles, accessibility_context,
        nearby_text, screenshot_reference, provider_metadata,
        created_at, status, resolution_summary,
        related_finding_ids, related_feedback_ids)
      VALUES (
        @id, @provider, @provider_annotation_id, @client_id, @project_id, @task_id, @session_id,
        @page_url, @viewport_width, @viewport_height, @viewport_scale,
        @comment, @kind, @intent, @severity,
        @element_tag, @element_selector, @bounding_box, @source_file,
        @component_tree, @css_classes, @computed_styles, @accessibility_context,
        @nearby_text, @screenshot_reference, @provider_metadata,
        @created_at, @status, @resolution_summary,
        @related_finding_ids, @related_feedback_ids)
      ON CONFLICT(id) DO UPDATE SET
        comment = excluded.comment,
        kind = excluded.kind,
        intent = excluded.intent,
        severity = excluded.severity,
        element_tag = excluded.element_tag,
        element_selector = excluded.element_selector,
        bounding_box = excluded.bounding_box,
        source_file = excluded.source_file,
        component_tree = excluded.component_tree,
        css_classes = excluded.css_classes,
        computed_styles = excluded.computed_styles,
        accessibility_context = excluded.accessibility_context,
        nearby_text = excluded.nearby_text,
        page_url = excluded.page_url,
        provider_metadata = excluded.provider_metadata
    `,
    ).run(row);
  })();
}

export function dbLoadFeedback(
  db: Database.Database,
  feedbackId: string,
): VisualFeedback | null {
  const row = db
    .prepare("SELECT * FROM feedback_items WHERE id = ?")
    .get(feedbackId) as FeedbackRow | undefined;
  return row ? rowToFeedback(row) : null;
}

export function dbListFeedback(
  db: Database.Database,
  filters?: { status?: string; pageUrl?: string; taskId?: string },
): VisualFeedback[] {
  let sql = "SELECT * FROM feedback_items";
  const conditions: string[] = [];
  const params: Record<string, string> = {};

  if (filters?.status) {
    conditions.push("status = @status");
    params.status = filters.status;
  }
  if (filters?.pageUrl) {
    conditions.push("page_url = @pageUrl");
    params.pageUrl = filters.pageUrl;
  }
  if (filters?.taskId) {
    conditions.push("task_id = @taskId");
    params.taskId = filters.taskId;
  }

  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY created_at DESC";

  const rows = db.prepare(sql).all(params) as FeedbackRow[];
  return rows.map(rowToFeedback);
}

/** Update lifecycle fields that the upsert deliberately preserves. */
export function dbUpdateFeedbackLifecycle(
  db: Database.Database,
  feedbackId: string,
  fields: {
    status?: string;
    taskId?: string;
    resolutionSummary?: string;
  },
): void {
  const setClauses: string[] = [];
  const params: Record<string, string> = { id: feedbackId };

  if (fields.status !== undefined) {
    setClauses.push("status = @status");
    params.status = fields.status;
  }
  if (fields.taskId !== undefined) {
    setClauses.push("task_id = @taskId");
    params.taskId = fields.taskId;
  }
  if (fields.resolutionSummary !== undefined) {
    setClauses.push("resolution_summary = @resolutionSummary");
    params.resolutionSummary = fields.resolutionSummary;
  }

  if (setClauses.length === 0) return;
  db.prepare(
    `UPDATE feedback_items SET ${setClauses.join(", ")} WHERE id = @id`,
  ).run(params);
}

export function dbFindFeedbackByProviderAnnotation(
  db: Database.Database,
  provider: string,
  providerAnnotationId: string,
  clientId: string,
): VisualFeedback | null {
  const row = db
    .prepare(
      "SELECT * FROM feedback_items WHERE provider = ? AND provider_annotation_id = ? AND client_id = ?",
    )
    .get(provider, providerAnnotationId, clientId) as FeedbackRow | undefined;
  return row ? rowToFeedback(row) : null;
}

// ─── Session CRUD ────────────────────────────────────────────────────────────

export function dbCreateSession(
  db: Database.Database,
  session: FeedbackSession,
): void {
  const row = sessionToRow(session);
  db.prepare(
    `
    INSERT INTO feedback_sessions (id, client_slug, provider, started_at, ended_at,
      page_urls, feedback_ids, status, reviewer_name)
    VALUES (@id, @client_slug, @provider, @started_at, @ended_at,
      @page_urls, @feedback_ids, @status, @reviewer_name)
  `,
  ).run(row);
}

export function dbLoadSession(
  db: Database.Database,
  sessionId: string,
): FeedbackSession | null {
  const row = db
    .prepare("SELECT * FROM feedback_sessions WHERE id = ?")
    .get(sessionId) as SessionRow | undefined;
  return row ? rowToSession(row) : null;
}

// ─── Session mappings ────────────────────────────────────────────────────────

export function dbSaveSessionMapping(
  db: Database.Database,
  agentationSessionId: string,
  clientSlug: string,
  workspacePath: string,
): void {
  const canonicalPath = normalizeWorkspacePath(workspacePath);

  // 1. Enforce global cross-workspace ownership first
  const claimResult = claimSessionOwnership(
    agentationSessionId,
    clientSlug,
    canonicalPath,
  );

  // 2. Enforce local client uniqueness constraint
  const existingLocal = db
    .prepare(
      "SELECT client_slug FROM session_mappings WHERE agentation_session_id = ?",
    )
    .get(agentationSessionId) as { client_slug: string } | undefined;

  if (existingLocal && existingLocal.client_slug !== clientSlug) {
    if (!claimResult.existing) {
      try {
        releaseSessionOwnership(agentationSessionId, clientSlug, canonicalPath);
      } catch {
        // ignore
      }
    }
    throw new VisualFeedbackError(
      `Agentation session "${agentationSessionId}" is already mapped to client "${existingLocal.client_slug}" and cannot be assigned to "${clientSlug}".`,
    );
  }

  // 3. Save into local workspace database atomically
  try {
    db.prepare(
      `
      INSERT OR REPLACE INTO session_mappings (agentation_session_id, client_slug, workspace_path, created_at)
      VALUES (?, ?, ?, ?)
    `,
    ).run(
      agentationSessionId,
      clientSlug,
      canonicalPath,
      new Date().toISOString(),
    );
  } catch (err) {
    if (!claimResult.existing) {
      try {
        releaseSessionOwnership(agentationSessionId, clientSlug, canonicalPath);
      } catch {
        // ignore
      }
    }
    throw err;
  }
}

export function dbGetClientForSession(
  db: Database.Database,
  agentationSessionId: string,
): string | null {
  const row = db
    .prepare(
      "SELECT client_slug FROM session_mappings WHERE agentation_session_id = ?",
    )
    .get(agentationSessionId) as { client_slug: string } | undefined;
  return row ? row.client_slug : null;
}

export function dbGetSessionsForClient(
  db: Database.Database,
  clientSlug: string,
): string[] {
  const rows = db
    .prepare(
      "SELECT agentation_session_id FROM session_mappings WHERE client_slug = ? ORDER BY created_at DESC",
    )
    .all(clientSlug) as Array<{ agentation_session_id: string }>;
  return rows.map((r) => r.agentation_session_id);
}

export function dbIsSessionMapped(
  db: Database.Database,
  agentationSessionId: string,
  clientSlug: string,
): boolean {
  const row = db
    .prepare(
      "SELECT 1 FROM session_mappings WHERE agentation_session_id = ? AND client_slug = ?",
    )
    .get(agentationSessionId, clientSlug);
  return row !== undefined;
}

export function dbRemoveSessionMapping(
  db: Database.Database,
  agentationSessionId: string,
  clientSlug?: string,
  workspacePath?: string,
): void {
  // Determine client slug from local DB if not explicitly supplied
  const ownerSlug =
    clientSlug ?? dbGetClientForSession(db, agentationSessionId);

  db.prepare(
    "DELETE FROM session_mappings WHERE agentation_session_id = ?",
  ).run(agentationSessionId);

  // Safely release global ownership for this client without deleting other clients' sessions
  if (ownerSlug) {
    releaseSessionOwnership(agentationSessionId, ownerSlug, workspacePath);
  }
}

// ─── Audit run CRUD ──────────────────────────────────────────────────────────

interface AuditRunRow {
  id: string;
  client_slug: string;
  type: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  target_url: string | null;
  pages_inspected: string;
  errors: string;
  limitations: string;
  environment: string;
  artifact_manifest: string;
}

function rowToAuditRun(row: AuditRunRow, findings: Finding[] = []): AuditRun {
  return {
    id: row.id,
    clientSlug: row.client_slug,
    type: row.type as AuditRun["type"],
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    status: row.status as AuditRun["status"],
    targetUrl: row.target_url ?? undefined,
    pagesInspected: jsonParse(row.pages_inspected, []),
    findings,
    artifactManifest: jsonParse(row.artifact_manifest, []),
    errors: jsonParse(row.errors, []),
    limitations: jsonParse(row.limitations, []),
    environment: jsonParse(row.environment, { os: "", nodeVersion: "" }),
  };
}

export function dbSaveAuditRun(db: Database.Database, audit: AuditRun): void {
  db.prepare(
    `
    INSERT OR REPLACE INTO audit_runs (id, client_slug, type, started_at, completed_at,
      status, target_url, pages_inspected, errors, limitations, environment, artifact_manifest)
    VALUES (@id, @client_slug, @type, @started_at, @completed_at,
      @status, @target_url, @pages_inspected, @errors, @limitations, @environment, @artifact_manifest)
  `,
  ).run({
    id: audit.id,
    client_slug: audit.clientSlug,
    type: audit.type,
    started_at: audit.startedAt,
    completed_at: audit.completedAt ?? null,
    status: audit.status,
    target_url: audit.targetUrl ?? null,
    pages_inspected: JSON.stringify(audit.pagesInspected),
    errors: JSON.stringify(audit.errors),
    limitations: JSON.stringify(audit.limitations),
    environment: JSON.stringify(audit.environment),
    artifact_manifest: JSON.stringify(audit.artifactManifest),
  });
}

export function dbLoadLatestAudit(
  db: Database.Database,
  type: string,
): AuditRun | null {
  const row = db
    .prepare(
      "SELECT * FROM audit_runs WHERE type = ? ORDER BY started_at DESC LIMIT 1",
    )
    .get(type) as AuditRunRow | undefined;
  if (!row) return null;

  const findingRows = db
    .prepare("SELECT * FROM findings WHERE audit_run_id = ?")
    .all(row.id) as FindingRow[];
  const findings = findingRows.map(rowToFinding);

  return rowToAuditRun(row, findings);
}

export function dbListAuditRuns(
  db: Database.Database,
  filters?: { type?: string; clientSlug?: string },
): AuditRun[] {
  let sql = "SELECT * FROM audit_runs";
  const conditions: string[] = [];
  const params: Record<string, string> = {};

  if (filters?.type) {
    conditions.push("type = @type");
    params.type = filters.type;
  }
  if (filters?.clientSlug) {
    conditions.push("client_slug = @clientSlug");
    params.clientSlug = filters.clientSlug;
  }

  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY started_at DESC";

  const rows = db.prepare(sql).all(params) as AuditRunRow[];
  return rows.map((r) => rowToAuditRun(r));
}

// ─── Findings CRUD ───────────────────────────────────────────────────────────

interface FindingRow {
  id: string;
  audit_run_id: string;
  category: string;
  severity: string;
  title: string;
  description: string | null;
  status: string;
  evidence: string;
  confidence: number | null;
  recommendation: string | null;
  verification_required: number;
  url: string | null;
  viewport: string | null;
  created_at: string | null;
}

function rowToFinding(row: FindingRow): Finding {
  return {
    id: row.id,
    category: row.category,
    severity: row.severity as Finding["severity"],
    title: row.title,
    description: row.description ?? undefined,
    status: row.status as Finding["status"],
    evidence: jsonParse(row.evidence, []),
    confidence: row.confidence ?? undefined,
    recommendation: row.recommendation ?? undefined,
    verificationRequired: row.verification_required === 1,
    url: row.url ?? undefined,
    viewport: row.viewport ?? undefined,
    createdAt: row.created_at ?? undefined,
  };
}

export function dbSaveFindings(
  db: Database.Database,
  auditRunId: string,
  findings: Finding[],
): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO findings (id, audit_run_id, category, severity, title, description,
      status, evidence, confidence, recommendation, verification_required, url, viewport, created_at)
    VALUES (@id, @audit_run_id, @category, @severity, @title, @description,
      @status, @evidence, @confidence, @recommendation, @verification_required, @url, @viewport, @created_at)
  `);

  const tx = db.transaction((items: Finding[]) => {
    for (const f of items) {
      stmt.run({
        id: f.id,
        audit_run_id: auditRunId,
        category: f.category,
        severity: f.severity,
        title: f.title,
        description: f.description ?? null,
        status: f.status,
        evidence: JSON.stringify(f.evidence),
        confidence: f.confidence ?? null,
        recommendation: f.recommendation ?? null,
        verification_required: f.verificationRequired ? 1 : 0,
        url: f.url ?? null,
        viewport: f.viewport ?? null,
        created_at: f.createdAt ?? null,
      });
    }
  });
  tx(findings);
}

export function dbQueryFindings(
  db: Database.Database,
  filters?: {
    severity?: string;
    category?: string;
    url?: string;
    auditRunId?: string;
  },
): Finding[] {
  let sql = "SELECT * FROM findings";
  const conditions: string[] = [];
  const params: Record<string, string> = {};

  if (filters?.severity) {
    conditions.push("severity = @severity");
    params.severity = filters.severity;
  }
  if (filters?.category) {
    conditions.push("category = @category");
    params.category = filters.category;
  }
  if (filters?.url) {
    conditions.push("url = @url");
    params.url = filters.url;
  }
  if (filters?.auditRunId) {
    conditions.push("audit_run_id = @auditRunId");
    params.auditRunId = filters.auditRunId;
  }

  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");

  const rows = db.prepare(sql).all(params) as FindingRow[];
  return rows.map(rowToFinding);
}

// ─── Plans CRUD ──────────────────────────────────────────────────────────────

export interface PlanMetaRow {
  id: string;
  title: string;
  clientSlug: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  estimatedScope: string | null;
  filePath: string | null;
  feedbackIds: string[];
}

export function dbSavePlanMeta(
  db: Database.Database,
  plan: ImplementationPlan,
  filePath: string,
): void {
  db.prepare(
    `
    INSERT OR REPLACE INTO plans (id, title, client_slug, status, created_at, updated_at,
      estimated_scope, file_path, feedback_ids)
    VALUES (@id, @title, @client_slug, @status, @created_at, @updated_at,
      @estimated_scope, @file_path, @feedback_ids)
  `,
  ).run({
    id: plan.id,
    title: plan.title,
    client_slug: plan.clientSlug,
    status: plan.status,
    created_at: plan.createdAt,
    updated_at: plan.updatedAt,
    estimated_scope: plan.estimatedScope ?? null,
    file_path: filePath,
    feedback_ids: JSON.stringify(plan.feedbackIds ?? []),
  });
}

export function dbListPlans(
  db: Database.Database,
  filters?: { status?: string; clientSlug?: string },
): PlanMetaRow[] {
  let sql = "SELECT * FROM plans";
  const conditions: string[] = [];
  const params: Record<string, string> = {};

  if (filters?.status) {
    conditions.push("status = @status");
    params.status = filters.status;
  }
  if (filters?.clientSlug) {
    conditions.push("client_slug = @clientSlug");
    params.clientSlug = filters.clientSlug;
  }

  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY created_at DESC";

  interface RawPlanRow {
    id: string;
    title: string;
    client_slug: string;
    status: string;
    created_at: string;
    updated_at: string;
    estimated_scope: string | null;
    file_path: string | null;
    feedback_ids: string;
  }

  const rows = db.prepare(sql).all(params) as RawPlanRow[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    clientSlug: r.client_slug,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    estimatedScope: r.estimated_scope,
    filePath: r.file_path,
    feedbackIds: jsonParse<string[]>(r.feedback_ids, []),
  }));
}
