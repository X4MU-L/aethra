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
  dbIsSessionMapped,
} from "../../engine/db.js";

// ─── Upstream annotation schema (Agentation API) ────────────────────────────

// ─── Upstream annotation schema (Agentation API) ────────────────────────────

const AgentationAnnotationSchema = z.object({
  id: z.string(),
  comment: z.string(),
  elementPath: z.string(),
  timestamp: z.union([z.number(), z.string()]),
  x: z.number().optional().default(0),
  y: z.number().optional().default(0),
  element: z.string(),
  // Optional fields
  url: z.string().optional(),
  severity: z.string().optional(),
  kind: z.string().optional(),
  intent: z.string().optional(),
  boundingBox: BoundingBoxSchema.optional(),
  reactComponents: z.union([z.string(), z.array(z.string())]).optional(),
  cssClasses: z.union([z.string(), z.array(z.string())]).optional(),
  sourceFile: z.string().optional(),
  attributes: z.record(z.unknown()).optional(),
  computedStyles: z.union([z.string(), z.record(z.unknown())]).optional(),
  accessibility: z.union([z.string(), z.record(z.unknown())]).optional(),
  nearbyText: z.string().optional(),
  selectedText: z.string().optional(),
  // Structured design input
  placement: z
    .object({
      componentType: z.string().optional(),
      component: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      scrollY: z.number().optional(),
      position: z.string().optional(),
      text: z.string().optional(),
    })
    .optional(),
  rearrange: z
    .object({
      selector: z.string().optional(),
      label: z.string().optional(),
      tagName: z.string().optional(),
      originalRect: BoundingBoxSchema.optional(),
      currentRect: BoundingBoxSchema.optional(),
      originalBounds: BoundingBoxSchema.optional(),
      currentBounds: BoundingBoxSchema.optional(),
    })
    .optional(),
  // Internal — injected by retrievePending or SSE
  _sessionId: z.string().optional(),
});

function normalizeCssClasses(val: string | string[] | undefined): string[] | undefined {
  if (!val) return undefined;
  if (Array.isArray(val)) {
    const cleaned = val.map((s) => String(s).trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned : undefined;
  }
  if (typeof val === "string") {
    const split = val.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    return split.length > 0 ? split : undefined;
  }
  return undefined;
}

function normalizeReactComponents(val: string | string[] | undefined): string[] | undefined {
  if (!val) return undefined;
  if (Array.isArray(val)) {
    const cleaned = val.map((s) => String(s).trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned : undefined;
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          const cleaned = parsed.map((s) => String(s).trim()).filter(Boolean);
          return cleaned.length > 0 ? cleaned : undefined;
        }
      } catch {
        // Fall through
      }
    }
    const split = trimmed.split(/\s*(?:>|,)\s*/).filter(Boolean);
    return split.length > 0 ? split : [trimmed];
  }
  return undefined;
}

function normalizeComputedStyles(
  val: string | Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (!val) return undefined;
  if (typeof val === "object" && !Array.isArray(val)) {
    const res: Record<string, string> = {};
    for (const [k, v] of Object.entries(val)) {
      if (typeof v === "string") res[k] = v;
      else if (v != null) res[k] = String(v);
    }
    return Object.keys(res).length > 0 ? res : undefined;
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          const res: Record<string, string> = {};
          for (const [k, v] of Object.entries(parsed)) {
            if (v != null) res[k] = String(v);
          }
          return Object.keys(res).length > 0 ? res : undefined;
        }
      } catch {
        // Fall through
      }
    }
    // Parse CSS declarations like "color: red; font-size: 14px;"
    const res: Record<string, string> = {};
    const rules = trimmed.split(";").map((r) => r.trim()).filter(Boolean);
    for (const rule of rules) {
      const idx = rule.indexOf(":");
      if (idx > 0) {
        const prop = rule.slice(0, idx).trim();
        const value = rule.slice(idx + 1).trim();
        if (prop && value) res[prop] = value;
      }
    }
    return Object.keys(res).length > 0 ? res : undefined;
  }
  return undefined;
}

function normalizeAccessibility(
  val: unknown,
): { role?: string; ariaLabel?: string; contrast?: number; violations?: string[] } | undefined {
  if (!val) return undefined;
  if (typeof val === "object" && val !== null && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>;
    const res: { role?: string; ariaLabel?: string; contrast?: number; violations?: string[] } = {};
    if (typeof obj.role === "string" && obj.role.trim()) res.role = obj.role.trim();
    if (typeof obj.ariaLabel === "string" && obj.ariaLabel.trim()) res.ariaLabel = obj.ariaLabel.trim();
    if (typeof obj.contrast === "number" && !isNaN(obj.contrast)) res.contrast = obj.contrast;
    if (Array.isArray(obj.violations)) {
      const v = obj.violations.map(String).filter(Boolean);
      if (v.length > 0) res.violations = v;
    }
    return Object.keys(res).length > 0 ? res : undefined;
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === "object" && parsed !== null) {
          return normalizeAccessibility(parsed);
        }
      } catch {
        // Fall through
      }
    }
    return trimmed ? { ariaLabel: trimmed } : undefined;
  }
  return undefined;
}

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

export type SessionValidationResult =
  | { status: "valid"; session?: Record<string, unknown>, reason?: string }
  | { status: "not-found"; statusCode: 404; reason: string }
  | { status: "unreachable"; reason: string; error?: Error }
  | { status: "server-error"; statusCode: number; reason: string }
  | { status: "malformed"; reason: string };

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

  /** Validate whether a session exists on the Agentation server with typed outcome. */
  async validateSession(sessionId: string): Promise<SessionValidationResult> {
    try {
      const res = await fetch(`${this.baseUrl}/sessions/${sessionId}`, {
        signal: AbortSignal.timeout(3000),
      });

      if (res.status === 404) {
        return {
          status: "not-found",
          statusCode: 404,
          reason: `Session "${sessionId}" was confirmed missing on Agentation server (HTTP 404).`,
        };
      }

      if (res.status >= 500) {
        return {
          status: "server-error",
          statusCode: res.status,
          reason: `Agentation server error (HTTP ${res.status}).`,
        };
      }

      if (!res.ok) {
        return {
          status: "server-error",
          statusCode: res.status,
          reason: `Agentation server returned HTTP ${res.status} (${res.statusText || "Request failed"}).`,
        };
      }

      let data: unknown;
      try {
        data = await res.json();
      } catch (parseErr) {
        return {
          status: "malformed",
          reason: `Agentation server returned malformed JSON: ${(parseErr as Error).message}`,
        };
      }

      if (!data || typeof data !== "object") {
        return {
          status: "malformed",
          reason: "Agentation server returned unexpected non-object JSON response.",
        };
      }

      const sessionObj = data as Record<string, unknown>;
      if (sessionObj.id !== undefined && String(sessionObj.id) !== sessionId) {
        return {
          status: "malformed",
          reason: `Agentation server returned mismatched session ID "${sessionObj.id}" (expected "${sessionId}").`,
        };
      }

      return {
        status: "valid",
        session: sessionObj,
      };
    } catch (err) {
      const error = err as Error;
      const isTimeout =
        error.name === "TimeoutError" ||
        error.name === "AbortError" ||
        error.message.toLowerCase().includes("timeout");
      return {
        status: "unreachable",
        reason: isTimeout
          ? `Connection to Agentation server timed out: ${error.message}`
          : `Could not reach Agentation server: ${error.message}`,
        error,
      };
    }
  }

  async startSession(opts: {
    pageUrl: string;
    clientSlug: string;
    sessionId?: string;
  }): Promise<{
    success: boolean;
    sessionUrl?: string;
    sessionId?: string;
    error?: string;
  }> {
    if (!this.isLocalUrl(opts.pageUrl)) {
      return {
        success: false,
        error:
          "Agentation sessions can only be started on local/development URLs. " +
          "Do not use Agentation on production sites.",
      };
    }

    // If an explicit sessionId is requested, verify it exists upstream
    if (opts.sessionId) {
      const validation = await this.validateSession(opts.sessionId);
      if (validation.status === "not-found") {
        return {
          success: false,
          error: `Specified session "${opts.sessionId}" does not exist on Agentation server (HTTP 404)`,
        };
      }
      if (validation.status !== "valid") {
        return {
          success: false,
          error: `Failed to validate session "${opts.sessionId}" upstream: ${validation.reason}`,
        };
      }

      if (this.workspacePath) {
        try {
          dbSaveSessionMapping(
            getDb(this.workspacePath),
            opts.sessionId,
            opts.clientSlug,
            this.workspacePath,
          );
        } catch (mapErr) {
          return {
            success: false,
            error: `Session mapping failed: ${(mapErr as Error).message}`,
          };
        }
      }

      logger.info(
        `Agentation session ${opts.sessionId} verified upstream and mapped to client "${opts.clientSlug}"`,
      );
      return {
        success: true,
        sessionUrl: opts.pageUrl,
        sessionId: opts.sessionId,
      };
    }

    // Otherwise, create a real session on the Agentation server
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

      const session = (await res.json()) as { id?: string };
      const agentationSessionId = session.id;
      if (!agentationSessionId) {
        return {
          success: false,
          error: "Agentation server returned empty session ID",
        };
      }

      // Map the session to this client workspace
      if (this.workspacePath) {
        try {
          dbSaveSessionMapping(
            getDb(this.workspacePath),
            agentationSessionId,
            opts.clientSlug,
            this.workspacePath,
          );
        } catch (mapErr) {
          return {
            success: false,
            error: `Session mapping failed: ${(mapErr as Error).message}`,
          };
        }
      }

      logger.info(
        `Agentation session ${agentationSessionId} created upstream and mapped to client "${opts.clientSlug}"`,
      );
      return {
        success: true,
        sessionUrl: opts.pageUrl,
        sessionId: agentationSessionId,
      };
    } catch (err) {
      return {
        success: false,
        error: `Could not reach Agentation server: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Detailed retrieval distinguishing empty queue from session failures.
   */
  async retrievePendingDetailed(clientSlug: string): Promise<{
    items: RawAnnotation[];
    errors: Array<{ sessionId: string; error: string }>;
  }> {
    if (!this.workspacePath) {
      logger.warn(
        "Agentation: no workspace context set — cannot filter by client. Call setContext() first.",
      );
      return {
        items: [],
        errors: [{ sessionId: "*", error: "No workspace context set" }],
      };
    }

    const db = getDb(this.workspacePath);
    const mappedSessionIds = dbGetSessionsForClient(db, clientSlug);

    if (mappedSessionIds.length === 0) {
      logger.debug(
        `Agentation: no sessions mapped to client "${clientSlug}". Use 'aethra feedback watch' to create a session.`,
      );
      return { items: [], errors: [] };
    }

    const items: RawAnnotation[] = [];
    const errors: Array<{ sessionId: string; error: string }> = [];

    for (const sessionId of mappedSessionIds) {
      try {
        const pendingRes = await fetch(
          `${this.baseUrl}/sessions/${sessionId}/pending`,
          { signal: AbortSignal.timeout(5000) },
        );
        if (!pendingRes.ok) {
          errors.push({
            sessionId,
            error: `Agentation server responded with HTTP ${pendingRes.status}`,
          });
          continue;
        }

        const data = (await pendingRes.json()) as
          | RawAnnotation[]
          | { count?: number; annotations?: RawAnnotation[] };

        const annotations = Array.isArray(data)
          ? data
          : Array.isArray(data?.annotations)
            ? data.annotations
            : [];

        for (const ann of annotations) {
          items.push({ ...ann, _sessionId: sessionId });
        }
      } catch (err) {
        errors.push({
          sessionId,
          error: (err as Error).message,
        });
      }
    }

    logger.info(
      `Agentation: retrieved ${items.length} pending annotations from ${mappedSessionIds.length} mapped session(s) for client "${clientSlug}" (${errors.length} session error(s))`,
    );
    return { items, errors };
  }

  async retrievePending(clientSlug: string): Promise<RawAnnotation[]> {
    const result = await this.retrievePendingDetailed(clientSlug);
    return result.items;
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
      componentTree: normalizeReactComponents(ann.reactComponents),
      cssClasses: normalizeCssClasses(ann.cssClasses),
      sourceFile: ann.sourceFile,
      nearbyText: ann.nearbyText,
      computedStyles: normalizeComputedStyles(ann.computedStyles),
      accessibilityContext: normalizeAccessibility(ann.accessibility),
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
    const isResolved = resolution?.status === "resolved";
    const isDismissed = resolution?.status === "dismissed";

    const patchBody = isResolved
      ? { status: "resolved", resolvedBy: "agent" }
      : isDismissed
        ? { status: "dismissed", resolvedBy: "agent" }
        : { status: "acknowledged" };

    const res = await fetch(`${this.baseUrl}/annotations/${annotationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `Agentation acknowledge failed (HTTP ${res.status}): ${errText || res.statusText}`,
      );
    }

    // If summary provided, append a thread message
    if (resolution?.summary && (isResolved || isDismissed)) {
      const threadContent = isResolved
        ? `Resolved: ${resolution.summary}`
        : `Dismissed: ${resolution.summary}`;

      const threadRes = await fetch(
        `${this.baseUrl}/annotations/${annotationId}/thread`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "agent", content: threadContent }),
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!threadRes.ok) {
        logger.warn(
          `Agentation thread update failed for ${annotationId} (HTTP ${threadRes.status})`,
        );
      }
    }

    logger.debug(`Agentation: acknowledged ${annotationId}`);
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
      logger.warn("Agentation server already running in this process");
      return;
    }

    this.port = port ?? 4747;
    this.baseUrl = `http://localhost:${this.port}`;

    // Check if a server is already alive on this port
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) {
        logger.info(`Agentation HTTP server already running on port ${this.port}`);
        return;
      }
    } catch {
      // Not running, proceed to start
    }

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

  /**
   * Process a parsed SSE event or raw line, enforcing fail-closed client workspace isolation.
   * Returns true if event was authorized and dispatched to callback, false if rejected/dropped.
   */
  processSSEEvent(
    event: Record<string, unknown>,
    callback: (annotation: RawAnnotation) => void,
    clientSlug?: string,
    streamSessionId?: string,
  ): boolean {
    if (
      event.type !== "annotation.created" ||
      (!event.payload && !event.annotation)
    ) {
      return false;
    }

    const ann = (event.payload ?? event.annotation) as RawAnnotation;
    const evSessionId =
      event.sessionId ?? ann.sessionId ?? ann._sessionId;

    let targetSessionId: string | undefined;

    if (streamSessionId) {
      // Session-scoped stream:
      // If event supplies a session ID that conflicts with the endpoint, fail closed and reject it
      if (evSessionId && String(evSessionId) !== streamSessionId) {
        logger.warn(
          `Agentation SSE: rejected event with conflicting sessionId "${evSessionId}" on stream for "${streamSessionId}"`,
        );
        return false;
      }
      // On session-scoped streams, event inherits the stream's session identity
      targetSessionId = streamSessionId;
    } else {
      // Global stream: event must supply a trustworthy session ID
      if (!evSessionId) {
        if (clientSlug) {
          logger.warn(
            `Agentation SSE: rejected event without sessionId for client "${clientSlug}" (fail-closed isolation)`,
          );
        }
        return false;
      }
      targetSessionId = String(evSessionId);
    }

    // Strict fail-closed isolation when clientSlug is provided:
    if (clientSlug) {
      if (!this.workspacePath) {
        logger.warn(
          `Agentation SSE: rejected event for client "${clientSlug}" because workspace context is missing (fail-closed isolation)`,
        );
        return false;
      }

      if (!targetSessionId) {
        logger.warn(
          `Agentation SSE: rejected event missing session identity for client "${clientSlug}" (fail-closed isolation)`,
        );
        return false;
      }

      const db = getDb(this.workspacePath);
      if (!dbIsSessionMapped(db, targetSessionId, clientSlug)) {
        logger.debug(
          `Agentation SSE: ignored annotation from session ${targetSessionId} (not mapped to client "${clientSlug}")`,
        );
        return false;
      }
    }

    callback({
      ...ann,
      _sessionId: targetSessionId,
    });
    return true;
  }

  async subscribeToEvents(
    callback: (annotation: RawAnnotation) => void,
    clientSlug?: string,
    sessionId?: string,
  ): Promise<void> {
    this.sseAbort = new AbortController();

    const streamUrl = sessionId
      ? `${this.baseUrl}/sessions/${sessionId}/events?agent=true`
      : `${this.baseUrl}/events?agent=true`;

    const runLoop = async () => {
      let backoffMs = 1000;
      const MAX_BACKOFF = 30_000;

      while (!this.sseAbort!.signal.aborted) {
        try {
          const res = await fetch(streamUrl, {
            headers: { Accept: "text/event-stream" },
            signal: this.sseAbort!.signal,
          });

          if (!res.ok || !res.body) {
            logger.warn(
              `Agentation SSE: failed to connect (${res.status}), retrying in ${backoffMs}ms`,
            );
            await this.abortableSleep(backoffMs);
            backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);
            continue;
          }

          // Connected — reset backoff
          backoffMs = 1000;
          logger.info(`Agentation: subscribed to SSE events (${sessionId ? `session ${sessionId}` : "global"})`);

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

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
                  this.processSSEEvent(event, callback, clientSlug, sessionId);
                } catch {
                  // Skip malformed SSE data
                }
              }
            }
          }

          // Stream ended normally — reconnect
          logger.info("Agentation SSE: stream ended, reconnecting...");
        } catch (err) {
          if ((err as Error).name === "AbortError") {
            break; // Intentional shutdown
          }
          logger.warn(
            `Agentation SSE error: ${(err as Error).message}, retrying in ${backoffMs}ms`,
          );
        }

        // Wait before reconnecting
        try {
          await this.abortableSleep(backoffMs);
        } catch {
          break; // Aborted during sleep
        }
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);
      }
    };

    // Run in background — don't await
    runLoop().catch((err) => {
      if ((err as Error).name !== "AbortError") {
        logger.warn(`Agentation SSE loop exited: ${(err as Error).message}`);
      }
    });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private abortableSleep(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      this.sseAbort?.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
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
