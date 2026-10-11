/**
 * Agentation visual feedback provider.
 * Connects to the Agentation HTTP server to retrieve and manage annotations.
 *
 * Architecture:
 * - Aethra bundles agentation-mcp as a dependency
 * - `startServer()` launches the HTTP server programmatically
 * - Provider communicates via REST API (GET /sessions, /annotations, etc.)
 * - SSE events at GET /events for real-time annotation streaming
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

// Severity mapping: Agentation → Aethra
const SEVERITY_MAP: Record<string, string> = {
  blocking: "critical",
  important: "high",
  suggestion: "medium",
};

// Kind mapping: Agentation → Aethra
const KIND_MAP: Record<string, string> = {
  placement: "style",
  rearrange: "enhancement",
};

// Intent mapping: Agentation → Aethra
const INTENT_MAP: Record<string, string> = {
  fix: "fix",
  change: "investigate",
  question: "investigate",
  approve: "approve",
};

export class AgentationProvider extends VisualFeedbackProvider {
  readonly name = "agentation";

  private port = 4747;
  private baseUrl = "http://localhost:4747";
  private serverHandle: { close: () => void } | null = null;
  private sseAbort: AbortController | null = null;

  async checkAvailability(): Promise<ProviderStatus> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      const connected = res.ok;
      return {
        available: true,
        connected,
        version: null,
        error: connected
          ? null
          : `Agentation server responded with ${res.status}`,
        capabilities: this.reportCapabilities(),
      };
    } catch {
      return {
        available: true,
        connected: false,
        version: null,
        error:
          "Agentation server not running. Start with: aethra feedback watch --provider agentation",
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
        `Consider using the manual provider for ${platform}.`,
    };
  }

  async startSession(opts: {
    pageUrl: string;
    clientSlug: string;
    sessionId: string;
  }): Promise<{ success: boolean; sessionUrl?: string; error?: string }> {
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
    try {
      // Get all sessions
      const sessionsRes = await fetch(`${this.baseUrl}/sessions`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!sessionsRes.ok) {
        logger.warn(
          `Agentation: failed to list sessions (${sessionsRes.status})`,
        );
        return [];
      }

      const sessions = (await sessionsRes.json()) as Array<{ id: string }>;
      const allPending: RawAnnotation[] = [];

      // Get pending annotations from each session
      for (const session of sessions) {
        try {
          const pendingRes = await fetch(
            `${this.baseUrl}/sessions/${session.id}/pending`,
            { signal: AbortSignal.timeout(5000) },
          );
          if (!pendingRes.ok) continue;

          const annotations = (await pendingRes.json()) as RawAnnotation[];
          for (const ann of annotations) {
            allPending.push({ ...ann, _sessionId: session.id });
          }
        } catch {
          // Skip sessions that fail
        }
      }

      logger.info(
        `Agentation: retrieved ${allPending.length} pending annotations from ${sessions.length} session(s)`,
      );
      return allPending;
    } catch (err) {
      logger.warn(
        `Agentation: retrievePending failed: ${(err as Error).message}`,
      );
      return [];
    }
  }

  normalize(raw: RawAnnotation, clientSlug: string): VisualFeedback {
    const now = new Date().toISOString();
    const rawSeverity = String(raw["severity"] ?? "suggestion");
    const rawKind = String(raw["kind"] ?? "feedback");
    const rawIntent = String(raw["intent"] ?? "fix");

    const kind =
      rawKind === "feedback"
        ? this.inferKindFromComment(raw)
        : (KIND_MAP[rawKind] ?? "other");

    return VisualFeedbackSchema.parse({
      id: crypto.randomBytes(8).toString("hex"),
      provider: this.name,
      providerAnnotationId: String(raw["id"]),
      clientId: clientSlug,
      sessionId: raw["_sessionId"] as string | undefined,
      pageUrl: raw["url"] ?? raw["pageUrl"] ?? "https://unknown",
      comment: raw["comment"] ?? "",
      kind,
      intent: INTENT_MAP[rawIntent] ?? "investigate",
      severity: SEVERITY_MAP[rawSeverity] ?? "medium",
      elementSelector: raw["elementPath"] as string | undefined,
      elementTag: raw["element"] as string | undefined,
      boundingBox: raw["boundingBox"] as
        | { x: number; y: number; width: number; height: number }
        | undefined,
      componentTree: raw["reactComponents"] as string[] | undefined,
      cssClasses: raw["cssClasses"] as string[] | undefined,
      sourceFile: raw["sourceFile"] as string | undefined,
      nearbyText: raw["nearbyText"] as string | undefined,
      computedStyles: raw["computedStyles"] as
        | Record<string, string>
        | undefined,
      accessibilityContext: raw["accessibility"] as
        | {
            role?: string;
            ariaLabel?: string;
            contrast?: number;
            violations?: string[];
          }
        | undefined,
      createdAt: (raw["timestamp"] as string) ?? now,
      status: "pending",
    });
  }

  async acknowledge(
    annotationId: string,
    resolution?: { status: string; summary: string },
  ): Promise<void> {
    try {
      if (resolution?.status === "resolved") {
        await fetch(`${this.baseUrl}/annotations/${annotationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isFixed: true,
            resolution: resolution.summary,
          }),
          signal: AbortSignal.timeout(5000),
        });
      } else if (resolution?.status === "dismissed") {
        await fetch(`${this.baseUrl}/annotations/${annotationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dismissed: true,
            dismissReason: resolution.summary,
          }),
          signal: AbortSignal.timeout(5000),
        });
      }
      logger.debug(`Agentation: acknowledged ${annotationId}`);
    } catch (err) {
      logger.warn(
        `Agentation: acknowledge failed for ${annotationId}: ${(err as Error).message}`,
      );
    }
  }

  reportCapabilities(): ProviderCapabilities {
    return {
      canStartSession: true,
      canAcknowledge: true,
      canResolve: true,
      supportsRealtime: true,
      supportedPlatforms: ["react", "nextjs"],
      requiresToolbarInstall: true,
    };
  }

  // ─── Server lifecycle ────────────────────────────────────────────────────

  /** Start the Agentation HTTP server programmatically. */
  async startServer(port?: number): Promise<void> {
    if (this.serverHandle) {
      logger.warn("Agentation server already running");
      return;
    }

    this.port = port ?? 4747;
    this.baseUrl = `http://localhost:${this.port}`;

    try {
      const { startHttpServer } = await import("agentation-mcp");
      this.serverHandle = startHttpServer(this.port);
      logger.info(`Agentation HTTP server started on port ${this.port}`);
    } catch (err) {
      logger.error(
        `Failed to start Agentation server: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  /** Stop the Agentation HTTP server. */
  async stopServer(): Promise<void> {
    if (this.sseAbort) {
      this.sseAbort.abort();
      this.sseAbort = null;
    }
    if (this.serverHandle) {
      this.serverHandle.close();
      this.serverHandle = null;
      logger.info("Agentation server stopped");
    }
  }

  /** Subscribe to real-time annotation events via SSE. */
  async subscribeToEvents(
    callback: (annotation: RawAnnotation) => void,
  ): Promise<void> {
    this.sseAbort = new AbortController();

    try {
      const res = await fetch(`${this.baseUrl}/events`, {
        headers: { Accept: "text/event-stream" },
        signal: this.sseAbort.signal,
      });

      if (!res.ok || !res.body) {
        logger.warn(`Agentation SSE: failed to connect (${res.status})`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const processStream = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6));
                if (event.type === "annotation.created" && event.annotation) {
                  callback(event.annotation as RawAnnotation);
                }
              } catch {
                // Skip malformed SSE data
              }
            }
          }
        }
      };

      processStream().catch((err) => {
        if ((err as Error).name !== "AbortError") {
          logger.warn(`Agentation SSE stream ended: ${(err as Error).message}`);
        }
      });

      logger.info("Agentation: subscribed to SSE events");
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        logger.warn(
          `Agentation SSE: connection failed: ${(err as Error).message}`,
        );
      }
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

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

  private inferKindFromComment(raw: RawAnnotation): string {
    const comment = String(raw["comment"] ?? "").toLowerCase();
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
    return "other";
  }
}
