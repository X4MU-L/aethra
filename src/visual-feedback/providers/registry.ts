/**
 * Visual feedback provider registry.
 * Manages available providers and their lifecycle.
 */

import type { VisualFeedbackProvider } from "./base.js";
import { ManualFeedbackProvider } from "./manual.js";
import { AgentationProvider } from "./agentation.js";

const providers = new Map<string, VisualFeedbackProvider>();

// Register built-in providers
providers.set("manual", new ManualFeedbackProvider());
providers.set("agentation", new AgentationProvider());

export function registerProvider(provider: VisualFeedbackProvider): void {
  providers.set(provider.name, provider);
}

export function getProvider(name: string): VisualFeedbackProvider | undefined {
  return providers.get(name);
}

export function listProviders(): VisualFeedbackProvider[] {
  return [...providers.values()];
}

export function getProviderNames(): string[] {
  return [...providers.keys()];
}
