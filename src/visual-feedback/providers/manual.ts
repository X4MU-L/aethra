/**
 * Manual visual feedback provider.
 * Always available — reads feedback from workspace feedback/items/ directory.
 * Serves as the fallback for platforms without toolbar support.
 */

import crypto from "crypto";
import type { PlatformType, ClientConfig } from "../../core/schemas.js";
import { VisualFeedbackError } from "../../core/errors.js";
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
    // Manual provider does not poll an external source.
    // Manual feedback is created via CLI commands and stored directly in SQLite.
    return [];
  }

  normalize(raw: RawAnnotation, clientSlug: string): VisualFeedback {
    const now = new Date().toISOString();
    const pageUrl = (raw["pageUrl"] ?? raw["url"]) as string | undefined;
    if (!pageUrl) {
      throw new VisualFeedbackError(
        `Manual feedback annotation ${raw.id ?? "unknown"} has no pageUrl`,
      );
    }

    return VisualFeedbackSchema.parse({
      id: raw["id"] ?? crypto.randomBytes(8).toString("hex"),
      provider: this.name,
      providerAnnotationId: raw["id"] ? String(raw["id"]) : undefined,
      clientId: clientSlug,
      pageUrl,
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
