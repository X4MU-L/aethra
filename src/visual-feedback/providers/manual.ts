/**
 * Manual visual feedback provider.
 * Always available — reads feedback from workspace feedback/items/ directory.
 * Serves as the fallback for platforms without toolbar support.
 */

import path from "path";
import crypto from "crypto";
import { glob } from "glob";
import { readJson, pathExists } from "../../engine/fs.js";
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

  private workspacePath: string | null = null;

  /** Set workspace context for reading file-based manual feedback. */
  setContext(workspacePath: string): void {
    this.workspacePath = workspacePath;
  }

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
    // Check if feedback/items directory exists in the workspace
    if (!this.workspacePath) return [];

    const itemsDir = path.join(this.workspacePath, "feedback", "items");
    if (!(await pathExists(itemsDir))) return [];

    try {
      const files = await glob("*.json", { cwd: itemsDir });
      const items: RawAnnotation[] = [];

      for (const file of files) {
        try {
          const content = await readJson<Record<string, unknown>>(
            path.join(itemsDir, file),
          );
          if (content && typeof content === "object") {
            const id = String(content["id"] ?? path.basename(file, ".json"));
            items.push({
              id,
              ...content,
            });
          }
        } catch {
          // Skip invalid JSON files
        }
      }

      return items;
    } catch {
      return [];
    }
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
