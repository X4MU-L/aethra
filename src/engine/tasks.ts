/**
 * Task lifecycle engine.
 * Tasks are the durable unit of delivery: they link a plan to its approval,
 * implementation, verification, and completion state.
 *
 * Each task lives in tasks/<id>/task.yaml within the client workspace.
 */

import path from 'path';
import crypto from 'crypto';
import { TaskRecordSchema, type TaskRecord, type TaskStatus } from '../core/schemas.js';
import { logger } from '../core/logger.js';
import { getDb, dbCreateTask, dbLoadTask, dbSaveTask, dbListTasks, dbFindTaskByPrefix } from './db.js';

const TASK_FILENAME = 'task.yaml';

/** Return the directory for a given task. */
export function taskDir(workspacePath: string, taskId: string): string {
  return path.join(workspacePath, 'tasks', taskId);
}

/** Return the path to a task's YAML record. */
export function taskFilePath(workspacePath: string, taskId: string): string {
  return path.join(taskDir(workspacePath, taskId), TASK_FILENAME);
}

/** Create a new task for an existing plan. */
export async function createTask(
  workspacePath: string,
  planId: string,
  planPath: string,
  title: string,
  clientSlug: string,
): Promise<TaskRecord> {
  const id = crypto.randomBytes(8).toString('hex');
  const now = new Date().toISOString();

  const task = TaskRecordSchema.parse({
    id,
    title,
    clientSlug,
    status: 'planned',
    planId,
    planPath,
    createdAt: now,
    updatedAt: now,
  });

  dbCreateTask(getDb(workspacePath), task);

  logger.debug(`Task created: ${id}`);
  return task;
}

/** Load a task by ID. Returns null if not found. */
export async function loadTask(
  workspacePath: string,
  taskId: string,
): Promise<TaskRecord | null> {
  return dbLoadTask(getDb(workspacePath), taskId);
}

/** Save (overwrite) a task record. */
export async function saveTask(
  workspacePath: string,
  task: TaskRecord,
): Promise<void> {
  task.updatedAt = new Date().toISOString();
  dbSaveTask(getDb(workspacePath), task);
}

/** Update specific fields on a task. */
export async function updateTask(
  workspacePath: string,
  taskId: string,
  updates: Partial<Omit<TaskRecord, 'id' | 'clientSlug' | 'createdAt'>>,
): Promise<TaskRecord> {
  const existing = await loadTask(workspacePath, taskId);
  if (!existing) {
    throw new Error(`Task not found: ${taskId}`);
  }
  const updated = TaskRecordSchema.parse({ ...existing, ...updates });
  await saveTask(workspacePath, updated);
  return updated;
}

/** Transition a task to a new status, enforcing valid transitions. */
export async function transitionTask(
  workspacePath: string,
  taskId: string,
  toStatus: TaskStatus,
  extras?: Partial<TaskRecord>,
): Promise<TaskRecord> {
  const task = await loadTask(workspacePath, taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const valid = validTransitions[task.status];
  if (!valid?.includes(toStatus)) {
    throw new Error(
      `Invalid status transition: ${task.status} → ${toStatus}. ` +
      `Allowed: ${valid?.join(', ') ?? 'none'}`,
    );
  }

  const now = new Date().toISOString();
  const patch: Partial<TaskRecord> = { status: toStatus, ...extras };

  if (toStatus === 'in-progress' && !task.startedAt) patch.startedAt = now;
  if (toStatus === 'completed') patch.completedAt = now;

  return updateTask(workspacePath, taskId, patch);
}

/** List all tasks in the workspace. */
export async function listTasks(workspacePath: string): Promise<TaskRecord[]> {
  return dbListTasks(getDb(workspacePath));
}

/** Find a task by partial ID prefix (first 8+ chars). */
export async function findTaskByPrefix(
  workspacePath: string,
  prefix: string,
): Promise<TaskRecord | null> {
  return dbFindTaskByPrefix(getDb(workspacePath), prefix);
}

/** Valid status transitions. */
const validTransitions: Record<TaskStatus, TaskStatus[]> = {
  planned: ['approved', 'abandoned'],
  approved: ['in-progress', 'abandoned', 'planned'],  // allow revocation back to planned
  'in-progress': ['verifying', 'blocked', 'abandoned'],
  verifying: ['completed', 'in-progress', 'blocked'],  // in-progress = re-implement
  completed: [],
  blocked: ['in-progress', 'abandoned'],
  abandoned: [],
};
