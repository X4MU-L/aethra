/**
 * Visual feedback manager.
 * Orchestrates feedback providers, persistence, and task lifecycle integration.
 */

import path from 'path';
import crypto from 'crypto';
import { writeJson, readJson, pathExists, ensureDir, listDir } from '../engine/fs.js';
import { VisualFeedbackSchema, FeedbackSessionSchema } from './schema.js';
import type { VisualFeedback, FeedbackSession } from './schema.js';
import type { Finding, ImplementationPlan, TaskRecord } from '../core/schemas.js';
import { getProvider, listProviders } from './providers/registry.js';
import { createTask } from '../engine/tasks.js';
import { logger } from '../core/logger.js';
import { VisualFeedbackError } from '../core/errors.js';

// ─── Feedback CRUD ───────────────────────────────────────────────────────────

function feedbackItemPath(workspacePath: string, id: string): string {
  return path.join(workspacePath, 'feedback', 'items', `${id}.json`);
}

function feedbackSessionPath(workspacePath: string, id: string): string {
  return path.join(workspacePath, 'feedback', 'sessions', `${id}.json`);
}

/** Save a feedback item to the workspace. */
export async function saveFeedback(
  workspacePath: string,
  feedback: VisualFeedback,
): Promise<void> {
  const dir = path.join(workspacePath, 'feedback', 'items');
  await ensureDir(dir);
  await writeJson(feedbackItemPath(workspacePath, feedback.id), feedback);
  logger.debug(`Feedback saved: ${feedback.id}`);
}

/** Load a feedback item by ID. */
export async function loadFeedback(
  workspacePath: string,
  feedbackId: string,
): Promise<VisualFeedback | null> {
  const fp = feedbackItemPath(workspacePath, feedbackId);
  if (!(await pathExists(fp))) return null;
  try {
    const raw = await readJson<unknown>(fp);
    return VisualFeedbackSchema.parse(raw);
  } catch (err) {
    logger.warn(`Could not parse feedback ${feedbackId}: ${(err as Error).message}`);
    return null;
  }
}

/** List feedback items with optional filters. */
export async function listFeedback(
  workspacePath: string,
  filters?: { status?: string; pageUrl?: string; taskId?: string },
): Promise<VisualFeedback[]> {
  const dir = path.join(workspacePath, 'feedback', 'items');
  if (!(await pathExists(dir))) return [];

  const entries = await listDir(dir);
  const items: VisualFeedback[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const raw = await readJson<unknown>(path.join(dir, entry));
      const item = VisualFeedbackSchema.parse(raw);

      if (filters?.status && item.status !== filters.status) continue;
      if (filters?.pageUrl && item.pageUrl !== filters.pageUrl) continue;
      if (filters?.taskId && item.taskId !== filters.taskId) continue;

      items.push(item);
    } catch {
      // Skip malformed feedback files
    }
  }

  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ─── Import from providers ───────────────────────────────────────────────────

/** Import pending feedback from a provider. */
export async function importFeedback(
  workspacePath: string,
  clientSlug: string,
  providerName: string,
): Promise<{ imported: VisualFeedback[]; errors: string[] }> {
  const provider = getProvider(providerName);
  if (!provider) {
    throw new VisualFeedbackError(`Unknown provider: ${providerName}`);
  }

  const status = await provider.checkAvailability();
  if (!status.available) {
    throw new VisualFeedbackError(
      `Provider "${providerName}" is not available: ${status.error ?? 'unknown reason'}`,
    );
  }

  const rawAnnotations = await provider.retrievePending(clientSlug);
  const imported: VisualFeedback[] = [];
  const errors: string[] = [];

  for (const raw of rawAnnotations) {
    try {
      const feedback = provider.normalize(raw, clientSlug);
      await saveFeedback(workspacePath, feedback);
      imported.push(feedback);
    } catch (err) {
      errors.push(`Failed to normalize annotation ${raw.id}: ${(err as Error).message}`);
    }
  }

  logger.info(`Imported ${imported.length} feedback items from ${providerName}`);
  if (errors.length > 0) {
    logger.warn(`${errors.length} import errors`);
  }

  return { imported, errors };
}

// ─── Lifecycle operations ────────────────────────────────────────────────────

/** Link a feedback item to an existing task. */
export async function linkFeedbackToTask(
  workspacePath: string,
  feedbackId: string,
  taskId: string,
): Promise<VisualFeedback> {
  const feedback = await loadFeedback(workspacePath, feedbackId);
  if (!feedback) {
    throw new VisualFeedbackError(`Feedback not found: ${feedbackId}`);
  }

  feedback.taskId = taskId;
  feedback.status = 'linked';
  await saveFeedback(workspacePath, feedback);

  logger.info(`Feedback ${feedbackId} linked to task ${taskId}`);
  return feedback;
}

/** Mark feedback as resolved. */
export async function resolveFeedback(
  workspacePath: string,
  feedbackId: string,
  summary: string,
  providerName?: string,
): Promise<VisualFeedback> {
  const feedback = await loadFeedback(workspacePath, feedbackId);
  if (!feedback) {
    throw new VisualFeedbackError(`Feedback not found: ${feedbackId}`);
  }

  feedback.status = 'resolved';
  feedback.resolutionSummary = summary;
  await saveFeedback(workspacePath, feedback);

  // Notify provider if specified
  const resolveProvider = providerName ?? feedback.provider;
  const provider = getProvider(resolveProvider);
  if (provider && feedback.providerAnnotationId) {
    try {
      await provider.acknowledge(feedback.providerAnnotationId, {
        status: 'resolved',
        summary,
      });
    } catch (err) {
      logger.warn(`Could not acknowledge to provider: ${(err as Error).message}`);
    }
  }

  logger.info(`Feedback ${feedbackId} resolved`);
  return feedback;
}

/** Convert feedback to a Finding for inclusion in audit/evidence. */
export function feedbackToFinding(feedback: VisualFeedback): Finding {
  return {
    id: `fb-${feedback.id}`,
    category: feedback.kind === 'accessibility' ? 'accessibility' : 'visual',
    severity: feedback.severity,
    title: feedback.comment.slice(0, 100),
    description: feedback.comment,
    status: feedback.status === 'resolved' ? 'resolved' : 'observed',
    evidence: feedback.screenshotReference
      ? [{ path: feedback.screenshotReference, type: 'visual-feedback' as const }]
      : [],
    verificationRequired: true,
    confidence: 1.0,
    url: feedback.pageUrl,
    viewport: feedback.viewport ? `${feedback.viewport.width}x${feedback.viewport.height}` : undefined,
    createdAt: feedback.createdAt,
  };
}

/** Create an implementation plan from feedback items. */
export async function createPlanFromFeedback(
  workspacePath: string,
  feedbackItems: VisualFeedback[],
  clientSlug: string,
): Promise<{ plan: ImplementationPlan; taskRecord: TaskRecord }> {
  if (feedbackItems.length === 0) {
    throw new VisualFeedbackError('No feedback items provided');
  }

  const planId = crypto.randomBytes(8).toString('hex');
  const now = new Date().toISOString();

  // Group feedback by page URL for context
  const pageUrls = [...new Set(feedbackItems.map((f) => f.pageUrl))];
  const title = feedbackItems.length === 1
    ? `Fix: ${feedbackItems[0]!.comment.slice(0, 60)}`
    : `Fix ${feedbackItems.length} visual feedback items on ${pageUrls.length} page(s)`;

  const description = feedbackItems
    .map((f, i) => `${i + 1}. [${f.kind}/${f.severity}] ${f.comment}${f.elementSelector ? ` (${f.elementSelector})` : ''}`)
    .join('\n');

  const plan: ImplementationPlan = {
    id: planId,
    title,
    taskDescription: description,
    clientSlug,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    evidenceBasis: feedbackItems
      .filter((f) => f.screenshotReference)
      .map((f) => ({
        path: f.screenshotReference!,
        type: 'visual-feedback' as const,
        description: f.comment.slice(0, 100),
        url: f.pageUrl,
      })),
    affectedFiles: feedbackItems
      .filter((f) => f.sourceFile)
      .map((f) => f.sourceFile!),
    affectedRoutes: pageUrls,
    proposedChanges: [],
    acceptanceCriteria: feedbackItems.map((f) => ({
      id: `ac-${crypto.randomBytes(4).toString('hex')}`,
      description: `Address feedback: ${f.comment.slice(0, 80)}`,
      category: 'visual' as const,
      verificationMethod: 'Visual inspection at same viewport and element',
    })),
    risks: [],
    dependencies: [],
    openQuestions: [],
    feedbackIds: feedbackItems.map((f) => f.id),
  };

  // Save plan
  const plansDir = path.join(workspacePath, 'plans');
  await ensureDir(plansDir);
  const planSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  const planPath = path.join(plansDir, `${planSlug}-${planId}.json`);
  await writeJson(planPath, plan);

  // Create task record
  const taskRecord = await createTask(workspacePath, planId, planPath, title, clientSlug);

  // Link all feedback items to the task
  for (const item of feedbackItems) {
    item.taskId = taskRecord.id;
    item.status = 'linked';
    await saveFeedback(workspacePath, item);
  }

  logger.info(`Plan created from ${feedbackItems.length} feedback items: ${planId}`);
  return { plan, taskRecord };
}

// ─── Session management ──────────────────────────────────────────────────────

/** Create a new feedback session. */
export async function createFeedbackSession(
  workspacePath: string,
  clientSlug: string,
  providerName: string,
  pageUrl: string,
): Promise<FeedbackSession> {
  const id = crypto.randomBytes(8).toString('hex');
  const session = FeedbackSessionSchema.parse({
    id,
    clientSlug,
    provider: providerName,
    startedAt: new Date().toISOString(),
    pageUrls: [pageUrl],
    feedbackIds: [],
    status: 'active',
  });

  const dir = path.join(workspacePath, 'feedback', 'sessions');
  await ensureDir(dir);
  await writeJson(feedbackSessionPath(workspacePath, id), session);

  logger.info(`Feedback session started: ${id}`);
  return session;
}

/** Get provider status for all registered providers. */
export async function getAllProviderStatus(): Promise<
  Array<{ name: string; status: { available: boolean; connected: boolean; version: string | null; error: string | null } }>
> {
  const results: Array<{ name: string; status: { available: boolean; connected: boolean; version: string | null; error: string | null } }> = [];

  for (const provider of listProviders()) {
    const status = await provider.checkAvailability();
    results.push({ name: provider.name, status });
  }

  return results;
}
