/**
 * Agent adapter registry.
 * Returns the appropriate adapter for the configured agent.
 */

import type { AgentAdapter } from "./adapter.js";
import { ClaudeCodeAdapter } from "./claude-code.js";

const adapters = new Map<string, () => AgentAdapter>();

// Register built-in adapters
adapters.set("claude-code", () => new ClaudeCodeAdapter());

export function getAdapter(name: string): AgentAdapter | null {
  const factory = adapters.get(name);
  return factory ? factory() : null;
}

export function getDefaultAdapter(): AgentAdapter {
  return new ClaudeCodeAdapter();
}

export function listAdapters(): string[] {
  return [...adapters.keys()];
}
