/**
 * Agentation visual feedback provider.
 * Connects to the Agentation MCP server to retrieve and manage annotations.
 *
 * Security:
 * - Only operates on loopback/localhost URLs
 * - Refuses to connect to production URLs
 * - Toolbar must not be present in production builds
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
import { logger } from "../../core/logger.js";

export class AgentationProvider extends VisualFeedbackProvider {
  readonly name = "agentation";

  async checkAvailability(): Promise<ProviderStatus> {
    try {
      // Try importing MCP client SDK
      const { Client } =
        await import("@modelcontextprotocol/sdk/client/index.js");

      // Agentation MCP server detection would go here.
      // For now, check if the SDK is available and report capabilities.
      // Actual connection requires the Agentation server to be running.
      void Client; // SDK is available

      return {
        available: true,
        connected: false,
        version: null,
        error:
          "Agentation server connection not yet configured. See: https://www.agentation.com/mcp",
        capabilities: this.reportCapabilities(),
      };
    } catch {
      return {
        available: false,
        connected: false,
        version: null,
        error: "Agentation MCP client not available",
        capabilities: this.reportCapabilities(),
      };
    }
  }

  async detectCompatibility(
    platform: PlatformType,
    _config: ClientConfig,
  ): Promise<{ compatible: boolean; reason: string }> {
    const nativelySupported: PlatformType[] = ["react", "nextjs"];

    if (nativelySupported.includes(platform)) {
      return {
        compatible: true,
        reason: `Agentation toolbar natively supports ${platform} projects`,
      };
    }

    return {
      compatible: false,
      reason:
        `Agentation toolbar requires a React/Next.js host. ` +
        `Consider using the manual or browser-overlay provider for ${platform}.`,
    };
  }

  async startSession(opts: {
    pageUrl: string;
    clientSlug: string;
    sessionId: string;
  }): Promise<{ success: boolean; sessionUrl?: string; error?: string }> {
    // Verify the URL is a local/development URL
    if (!this.isLocalUrl(opts.pageUrl)) {
      return {
        success: false,
        error:
          "Agentation sessions can only be started on local/development URLs. " +
          "Do not use Agentation on production sites.",
      };
    }

    logger.info(`Agentation session prepared for ${opts.pageUrl}`);
    return {
      success: true,
      sessionUrl: opts.pageUrl,
    };
  }

  async retrievePending(_clientSlug: string): Promise<RawAnnotation[]> {
    // TODO: Connect to Agentation MCP server and call list_annotations tool
    // This requires the Agentation server to be running and configured.
    // For now, return empty — annotations are retrieved when the server is integrated.
    logger.debug("Agentation: retrievePending not yet connected to MCP server");
    return [];
  }

  normalize(raw: RawAnnotation, clientSlug: string): VisualFeedback {
    const now = new Date().toISOString();

    return VisualFeedbackSchema.parse({
      id: crypto.randomBytes(8).toString("hex"),
      provider: this.name,
      providerAnnotationId: String(raw["id"]),
      clientId: clientSlug,
      pageUrl: raw["pageUrl"] ?? raw["url"] ?? "https://unknown",
      comment: raw["comment"] ?? raw["text"] ?? raw["content"] ?? "",
      kind: this.inferKind(raw),
      intent: raw["intent"] ?? "investigate",
      severity: raw["severity"] ?? "medium",
      elementSelector: raw["selector"] as string | undefined,
      elementTag: raw["tag"] as string | undefined,
      boundingBox: raw["boundingBox"] as
        | { x: number; y: number; width: number; height: number }
        | undefined,
      componentTree: raw["componentTree"] as string[] | undefined,
      cssClasses: raw["cssClasses"] as string[] | undefined,
      sourceFile: raw["sourceFile"] as string | undefined,
      nearbyText: raw["nearbyText"] as string | undefined,
      viewport: raw["viewport"] as
        | { width: number; height: number; deviceScaleFactor?: number }
        | undefined,
      screenshotReference: raw["screenshot"] as string | undefined,
      createdAt: (raw["createdAt"] as string) ?? now,
      status: "pending",
    });
  }

  async acknowledge(
    annotationId: string,
    resolution?: { status: string; summary: string },
  ): Promise<void> {
    // TODO: Connect to Agentation MCP server and call resolve_annotation tool
    logger.debug(`Agentation: acknowledge ${annotationId}`, resolution);
  }

  reportCapabilities(): ProviderCapabilities {
    return {
      canStartSession: true,
      canAcknowledge: true,
      canResolve: true,
      supportsRealtime: false, // polling-based for now
      supportedPlatforms: ["react", "nextjs"],
      requiresToolbarInstall: true,
    };
  }

  private isLocalUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1" ||
        host.endsWith(".local") ||
        host.endsWith(".test") ||
        host.endsWith(".localhost")
      );
    } catch {
      return false;
    }
  }

  private inferKind(raw: RawAnnotation): string {
    const comment = String(raw["comment"] ?? raw["text"] ?? "").toLowerCase();
    if (
      comment.includes("bug") ||
      comment.includes("broken") ||
      comment.includes("error")
    )
      return "bug";
    if (
      comment.includes("style") ||
      comment.includes("css") ||
      comment.includes("color")
    )
      return "style";
    if (comment.includes("accessibility") || comment.includes("a11y"))
      return "accessibility";
    if (
      comment.includes("content") ||
      comment.includes("text") ||
      comment.includes("copy")
    )
      return "content";
    if (
      comment.includes("improve") ||
      comment.includes("enhance") ||
      comment.includes("better")
    )
      return "enhancement";
    if (
      comment.includes("?") ||
      comment.includes("why") ||
      comment.includes("how")
    )
      return "question";
    return (raw["kind"] as string) ?? "other";
  }
}
