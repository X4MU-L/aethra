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
 * - Session-scoped retrieval: only fetches from sessions mapped to the active client
 * - Toolbar must not be present in production builds
 */

import crypto from "crypto";
import { z } from "zod";
import type { PlatformType, ClientConfig } from "../../core/schemas.js";
import type { VisualFeedback } from "../schema.js";
import { VisualFeedbackSchema, BoundingBoxSchema } from "../schema.js";
import type {
  ProviderCapabilities,
  ProviderStatus,
  RawAnnotation,
} from "./base.js";
import { VisualFeedbackProvider } from "./base.js";
import { VisualFeedbackError } from "../../core/errors.js";
import { logger } from "../../core/logger.js";
import {
  getDb,
  dbGetSessionsForClient,
  dbSaveSessionMapping,
} from "../../engine/db.js";

// ─── Upstream annotation schema (Agentation API) ────────────────────────────

const AgentationAnnotationSchema = z.object({
  id: z.string(),
  comment: z.string(),
  elementPath: z.string(),
  timestamp: z.union([z.number(), z.string()]),
  x: z.number(),
  y: z.number(),
  element: z.string(),
  // Optional fields
  url: z.string().url().optional(),
  severity: z.string().optional(),
  kind: z.string().optional(),
  intent: z.string().optional(),
  boundingBox: BoundingBoxSchema.optional(),
  reactComponents: z.array(z.string()).optional(),
  cssClasses: z.array(z.string()).optional(),
  sourceFile: z.string().optional(),
  attributes: z.record(z.unknown()).optional(),
  computedStyles: z.record(z.string()).optional(),
  accessibility: z
    .object({
      role: z.string().optional(),
      ariaLabel: z.string().optional(),
      contrast: z.number().optional(),
      violations: z.array(z.string()).optional(),
    })
    .optional(),
  nearbyText: z.string().optional(),
  selectedText: z.string().optional(),
  // Structured design input
  placement: z
    .object({
      component: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      position: z.string().optional(),
    })
    .optional(),
  rearrange: z
    .object({
      originalBounds: BoundingBoxSchema.optional(),
      currentBounds: BoundingBoxSchema.optional(),
    })
    .optional(),
  // Internal — injected by retrievePending
  _sessionId: z.string().optional(),
});

// ─── Enum mappings ───────────────────────────────────────────────────────────

const SEVERITY_MAP: Record<string, string> = {
  blocking: "critical",
  important: "high",
  suggestion: "medium",
};

const KIND_MAP: Record<string, string> = {
  placement: "style",
  rearrange: "enhancement",
};

const INTENT_MAP: Record<string, string> = {
  fix: "fix",
  change: "investigate",
  question: "investigate",
  approve: "approve",
};

// ─── Provider ────────────────────────────────────────────────────────────────

export class AgentationProvider extends VisualFeedbackProvider {
  readonly name = "agentation";

  private port = 4747;
  private baseUrl = "http://localhost:4747";
  private serverHandle: { close: () => void } | null = null;
  private sseAbort: AbortController | null = null;
  private workspacePath: string | null = null;

  /** Set workspace context for DB-backed operations (session mapping, etc.) */
  setContext(workspacePath: string): void {
    this.workspacePath = workspacePath;
  }

  async checkAvailability(): Promise<ProviderStatus> {
    // Check if agentation-mcp package is installed
    let installed = false;
    try {
      await import("agentation-mcp");
      installed = true;
    } catch {
      return {
        available: false,
        connected: false,
        version: null,
        error:
          "agentation-mcp package is not installed. Run: npm install agentation-mcp",
        capabilities: this.reportCapabilities(),
      };
    }

    // Package installed — check if server is running
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      const connected = res.ok;
      return {
        available: installed,
        connected,
        version: null,
        error: connected
          ? null
          : `Agentation server responded with ${res.status}`,
        capabilities: this.reportCapabilities(),
      };
    } catch {
      return {
        available: installed,
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

    // Create a real session on the Agentation server
    try {
      const res = await fetch(`${this.baseUrl}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: opts.pageUrl,
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        return {
          success: false,
          error: `Failed to create Agentation session: HTTP ${res.status}`,
        };
      }

      const session = (await res.json()) as { id: string };
      const agentationSessionId = session.id ?? opts.sessionId;

      // Map the session to this client workspace
      if (this.workspacePath) {
        dbSaveSessionMapping(
          getDb(this.workspacePath),
          agentationSessionId,
          opts.clientSlug,
          this.workspacePath,
        );
      }

      logger.info(
        `Agentation session ${agentationSessionId} created and mapped to client "${opts.clientSlug}"`,
      );
      return {
        success: true,
        sessionUrl: opts.pageUrl,
      };
    } catch (err) {
      return {
        success: false,
        error: `Could not reach Agentation server: ${(err as Error).message}`,
      };
    }
  }

  async retrievePending(clientSlug: string): Promise<RawAnnotation[]> {
    // Enforce session isolation: only fetch from sessions mapped to this client
    if (!this.workspacePath) {
      logger.warn(
        "Agentation: no workspace context set — cannot filter by client. Call setContext() first.",
      );
      return [];
    }

    const db = getDb(this.workspacePath);
    const mappedSessionIds = dbGetSessionsForClient(db, clientSlug);

    if (mappedSessionIds.length === 0) {
      logger.debug(
        `Agentation: no sessions mapped to client "${clientSlug}". Use 'aethra feedback watch' to create a session.`,
      );
      return [];
    }

    try {
      const allPending: RawAnnotation[] = [];

      for (const sessionId of mappedSessionIds) {
        try {
          const pendingRes = await fetch(
            `${this.baseUrl}/sessions/${sessionId}/pending`,
            { signal: AbortSignal.timeout(5000) },
          );
          if (!pendingRes.ok) continue;

          const annotations = (await pendingRes.json()) as RawAnnotation[];
          for (const ann of annotations) {
            allPending.push({ ...ann, _sessionId: sessionId });
          }
        } catch {
          // Skip sessions that fail
        }
      }

      logger.info(
        `Agentation: retrieved ${allPending.length} pending annotations from ${mappedSessionIds.length} mapped session(s) for client "${clientSlug}"`,
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
    // Step 1: Parse and validate the upstream shape
    const parseResult = AgentationAnnotationSchema.safeParse(raw);
    if (!parseResult.success) {
      throw new VisualFeedbackError(
        `Invalid Agentation annotation (id=${String(raw.id ?? "unknown")}): ${parseResult.error.message}`,
      );
    }
    const ann = parseResult.data;

    // Step 2: Convert timestamp (numeric ms epoch → ISO string)
    let createdAt: string;
    if (typeof ann.timestamp === "number") {
      createdAt = new Date(ann.timestamp).toISOString();
    } else {
      createdAt = ann.timestamp;
    }

    // Step 3: Require URL — reject if missing
    if (!ann.url) {
      throw new VisualFeedbackError(
        `Agentation annotation ${ann.id} has no URL; cannot import without page context`,
      );
    }

    // Step 4: Map enums
    const rawSeverity = ann.severity ?? "suggestion";
    const rawKind = ann.kind ?? "feedback";
    const rawIntent = ann.intent ?? "fix";

    const kind =
      rawKind === "feedback"
        ? this.inferKindFromComment(ann.comment)
        : (KIND_MAP[rawKind] ?? "other");

    // Step 5: Stable ID derivation (deterministic from provider annotation + client)
    const stableId = crypto
      .createHash("sha256")
      .update(`agentation:${ann.id}:${clientSlug}`)
      .digest("hex")
      .slice(0, 16);

    // Step 6: Preserve structured provider data
    const providerMetadata: Record<string, unknown> = {};
    if (ann.placement) providerMetadata.placement = ann.placement;
    if (ann.rearrange) providerMetadata.rearrange = ann.rearrange;
    if (ann.selectedText) providerMetadata.selectedText = ann.selectedText;
    if (ann.attributes) providerMetadata.attributes = ann.attributes;
    // Preserve original kind for structured annotations
    if (rawKind === "placement" || rawKind === "rearrange") {
      providerMetadata.originalKind = rawKind;
    }

    return VisualFeedbackSchema.parse({
      id: stableId,
      provider: this.name,
      providerAnnotationId: ann.id,
      clientId: clientSlug,
      sessionId: ann._sessionId,
      pageUrl: ann.url,
      comment: ann.comment,
      kind,
      intent: INTENT_MAP[rawIntent] ?? "investigate",
      severity: SEVERITY_MAP[rawSeverity] ?? "medium",
      elementSelector: ann.elementPath,
      elementTag: ann.element,
      boundingBox: ann.boundingBox,
      componentTree: ann.reactComponents,
      cssClasses: ann.cssClasses,
      sourceFile: ann.sourceFile,
      nearbyText: ann.nearbyText,
      computedStyles: ann.computedStyles,
      accessibilityContext: ann.accessibility,
      providerMetadata:
        Object.keys(providerMetadata).length > 0 ? providerMetadata : undefined,
      createdAt,
      status: "pending",
    });
  }

  async acknowledge(
    annotationId: string,
    resolution?: { status: string; summary: string },
  ): Promise<void> {
    try {
      const body =
        resolution?.status === "resolved"
          ? { isFixed: true, resolution: resolution.summary }
          : resolution?.status === "dismissed"
            ? { dismissed: true, dismissReason: resolution.summary }
            : { acknowledged: true };

      const res = await fetch(`${this.baseUrl}/annotations/${annotationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        logger.warn(
          `Agentation: acknowledge HTTP ${res.status} for ${annotationId}`,
        );
        return;
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

  private inferKindFromComment(comment: string): string {
    const lower = comment.toLowerCase();
    if (
      lower.includes("bug") ||
      lower.includes("broken") ||
      lower.includes("error")
    )
      return "bug";
    if (
      lower.includes("style") ||
      lower.includes("css") ||
      lower.includes("color")
    )
      return "style";
    if (lower.includes("accessibility") || lower.includes("a11y"))
      return "accessibility";
    if (
      lower.includes("content") ||
      lower.includes("text") ||
      lower.includes("copy")
    )
      return "content";
    if (
      lower.includes("improve") ||
      lower.includes("enhance") ||
      lower.includes("better")
    )
      return "enhancement";
    if (lower.includes("?") || lower.includes("why") || lower.includes("how"))
      return "question";
    return "other";
  }
}
