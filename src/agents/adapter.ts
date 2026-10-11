/**
 * Agent adapter interface.
 * Defines how Aethra delegates implementation work to AI agents.
 */

import type { ImplementationPlan } from '../core/schemas.js';
import type { SkillSelection } from '../engine/context.js';

export interface AgentContext {
  plan: ImplementationPlan;
  planPath: string;
  workspacePath: string;
  repositoryPath: string;
  gitBranch?: string;
  skills: SkillSelection[];
  evidencePaths: string[];
  taskId?: string;
}

export interface AgentResult {
  status: 'completed' | 'partial' | 'failed' | 'not-available';
  agentName: string;
  instructionPath: string;
  outputLog?: string;
  filesModified?: string[];
  error?: string;
}

export interface AgentAdapter {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  prepareContext(ctx: AgentContext): Promise<string>;
  launch(ctx: AgentContext, opts?: { dryRun?: boolean }): Promise<AgentResult>;
}
