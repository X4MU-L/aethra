/**
 * Abstract visual feedback provider.
 * Defines the interface for connecting to annotation systems.
 */

import type { PlatformType, ClientConfig } from "../../core/schemas.js";
import type { VisualFeedback } from "../schema.js";

export interface ProviderCapabilities {
  canStartSession: boolean;
  canAcknowledge: boolean;
  canResolve: boolean;
  supportsRealtime: boolean;
  supportedPlatforms: PlatformType[];
  requiresToolbarInstall: boolean;
}

export interface ProviderStatus {
  available: boolean;
  connected: boolean;
  version: string | null;
  error: string | null;
  capabilities: ProviderCapabilities;
}

export interface RawAnnotation {
  id: string;
  [key: string]: unknown;
}

export abstract class VisualFeedbackProvider {
  abstract readonly name: string;

  /** Check if the provider is available and connectable. */
  abstract checkAvailability(): Promise<ProviderStatus>;

  /** Check if the provider is compatible with the given platform. */
  abstract detectCompatibility(
    platform: PlatformType,
    config: ClientConfig,
  ): Promise<{ compatible: boolean; reason: string }>;

  /** Start a feedback session. */
  abstract startSession(opts: {
    pageUrl: string;
    clientSlug: string;
    sessionId: string;
  }): Promise<{
    success: boolean;
    sessionUrl?: string;
    sessionId?: string;
    error?: string;
  }>;

  /** Retrieve pending annotations from the provider. */
  abstract retrievePending(clientSlug: string): Promise<RawAnnotation[]>;

  /** Normalize a raw annotation into Aethra's VisualFeedback schema. */
  abstract normalize(raw: RawAnnotation, clientSlug: string): VisualFeedback;

  /** Acknowledge or resolve an annotation through the provider. */
  abstract acknowledge(
    annotationId: string,
    resolution?: { status: string; summary: string },
  ): Promise<void>;

  /** Report the capabilities of this provider. */
  abstract reportCapabilities(): ProviderCapabilities;
}
