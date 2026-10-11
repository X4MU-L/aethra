/**
 * Manual visual feedback provider.
 * Always available — reads feedback from workspace feedback/items/ directory.
 * Serves as the fallback for platforms without toolbar support.
 */

import crypto from "crypto";
import type { PlatformType, ClientConfig } from "../../core/schemas.js";
import type { VisualFeedback } from "../schema.js";
import { VisualFeedbackSchema } from "../schema.js";
import type {
  ProviderCapabilities,
  ProviderStatus,
  RawAnnotation,
} from "./base.js";
import { VisualFeedbackProvider } from "./base.js";

export class ManualFeedbackProvider extends VisualFeedbackProvider {
  readonly name = "manual";

  async checkAvailability(): Promise<ProviderStatus> {
    return {
      available: true,
      connected: true,
      version: null,
      error: null,
      capabilities: this.reportCapabilities(),
    };
  }

  async detectCompatibility(
    _platform: PlatformType,
    _config: ClientConfig,
  ): Promise<{ compatible: boolean; reason: string }> {
    // Manual provider is always compatible
    return { compatible: true, reason: "Manual feedback is always available" };
  }

  async startSession(_opts: {
    pageUrl: string;
    clientSlug: string;
    sessionId: string;
  }): Promise<{ success: boolean; sessionUrl?: string; error?: string }> {
    // Manual sessions don't need provider-side initialization
    return { success: true };
  }

  async retrievePending(_clientSlug: string): Promise<RawAnnotation[]> {
    // Manual provider doesn't have a remote source to poll.
    // Feedback items are already in the workspace as JSON files.
    return [];
  }

  normalize(raw: RawAnnotation, clientSlug: string): VisualFeedback {
    const now = new Date().toISOString();
    return VisualFeedbackSchema.parse({
      id: raw["id"] ?? crypto.randomBytes(8).toString("hex"),
      provider: this.name,
      providerAnnotationId: String(raw["id"]),
      clientId: clientSlug,
      pageUrl: raw["pageUrl"] ?? raw["url"] ?? "https://unknown",
      comment: raw["comment"] ?? raw["text"] ?? "",
      kind: raw["kind"] ?? "other",
      intent: raw["intent"] ?? "investigate",
      severity: raw["severity"] ?? "medium",
      elementSelector: raw["selector"] as string | undefined,
      elementTag: raw["tag"] as string | undefined,
      createdAt: (raw["createdAt"] as string) ?? now,
      status: "pending",
    });
  }

  async acknowledge(
    _annotationId: string,
    _resolution?: { status: string; summary: string },
  ): Promise<void> {
    // Manual provider doesn't need external acknowledgment
  }

  reportCapabilities(): ProviderCapabilities {
    return {
      canStartSession: false,
      canAcknowledge: false,
      canResolve: false,
      supportsRealtime: false,
      supportedPlatforms: [
        "wordpress",
        "woocommerce",
        "shopify",
        "nextjs",
        "react",
        "node",
        "static",
        "unknown",
        "hybrid",
      ],
      requiresToolbarInstall: false,
    };
  }
}
