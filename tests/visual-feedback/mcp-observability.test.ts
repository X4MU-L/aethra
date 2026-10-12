/**
 * Tests for MCP retrieval observability and error propagation.
 *
 * Requirements:
 * - A genuinely empty, successfully queried queue must remain distinguishable from an unavailable server.
 * - Non-successful HTTP responses must not silently become an empty queue.
 * - Partial session failures must be surfaced with affected sessions.
 * - If every relevant session fails, an explicit failure status is returned.
 * - Deduplication across multiple authorized sessions is preserved.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "fs-extra";
import {
  getDb,
  closeDb,
  dbSaveSessionMapping,
  setGlobalRegistryPath,
  clearGlobalRegistry,
} from "../../src/engine/db.js";
import {
  testFetchScopedPendingAnnotations,
  testHandleGetPendingAnnotations,
} from "../../src/mcp/server.js";

describe("MCP Pending Annotation Observability", () => {
  let tmpRoot: string;
  let workspace: string;
  let origFetch: typeof globalThis.fetch;
  let origAethraHome: string | undefined;

  beforeEach(async () => {
    origAethraHome = process.env.AETHRA_HOME;
    tmpRoot = path.join(
      os.tmpdir(),
      `aethra-mcp-obs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    workspace = path.join(tmpRoot, "client-x");
    const aethraHome = path.join(tmpRoot, ".aethra");
    process.env.AETHRA_HOME = aethraHome;

    await fs.ensureDir(workspace);
    await fs.ensureDir(aethraHome);

    setGlobalRegistryPath(path.join(aethraHome, "session-registry.db"));

    await fs.writeFile(
      path.join(workspace, "client.yaml"),
      "slug: client-x\nname: Client X\nprimaryUrl: http://localhost:3000\n",
    );

    origFetch = globalThis.fetch;
  });

  afterEach(async () => {
    globalThis.fetch = origFetch;
    closeDb(workspace);
    clearGlobalRegistry();
    setGlobalRegistryPath(null);
    if (origAethraHome !== undefined) {
      process.env.AETHRA_HOME = origAethraHome;
    } else {
      delete process.env.AETHRA_HOME;
    }
    await fs.remove(tmpRoot);
  });

  it("distinguishes genuinely empty queue from network failures", async () => {
    const db = getDb(workspace);
    dbSaveSessionMapping(db, "session-empty", "client-x", workspace);

    // Mock fetch returning empty array with HTTP 200
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("/sessions/session-empty/pending")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await testFetchScopedPendingAnnotations(workspace);
    expect(res.annotations).toEqual([]);
    expect(res.successSessions).toEqual(["session-empty"]);
    expect(res.failedSessions).toEqual([]);

    const handleRes = await testHandleGetPendingAnnotations(workspace);
    expect((handleRes as { isError?: boolean }).isError).toBeFalsy();
    const parsed = JSON.parse(handleRes.content[0].text);
    expect(parsed.count).toBe(0);
    expect(parsed.partial).toBeUndefined();
  });

  it("surfaces total failure when all mapped sessions fail", async () => {
    const db = getDb(workspace);
    dbSaveSessionMapping(db, "session-err-1", "client-x", workspace);
    dbSaveSessionMapping(db, "session-err-2", "client-x", workspace);

    // Mock fetch failing on both
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("session-err-1")) {
        return new Response("Internal Server Error", { status: 500 });
      }
      if (urlStr.includes("session-err-2")) {
        throw new Error("Connection refused");
      }
      if (urlStr.includes("/health")) {
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await testFetchScopedPendingAnnotations(workspace);
    expect(res.annotations).toHaveLength(0);
    expect(res.successSessions).toHaveLength(0);
    expect(res.failedSessions).toHaveLength(2);

    const handleRes = await testHandleGetPendingAnnotations(workspace);
    // Must return an explicit error result, NOT a silent empty queue
    expect((handleRes as { isError?: boolean }).isError).toBe(true);
    expect(handleRes.content[0].text).toContain("Failed to retrieve pending annotations for all mapped sessions");
    expect(handleRes.content[0].text).toContain("session-err-1");
    expect(handleRes.content[0].text).toContain("session-err-2");
  });

  it("surfaces partial success and identifies failed sessions", async () => {
    const db = getDb(workspace);
    dbSaveSessionMapping(db, "session-good", "client-x", workspace);
    dbSaveSessionMapping(db, "session-bad", "client-x", workspace);

    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("/health")) {
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      if (urlStr.includes("session-good")) {
        return new Response(
          JSON.stringify([{ id: "ann-good-1", comment: "Legitimate annotation" }]),
          { status: 200 },
        );
      }
      if (urlStr.includes("session-bad")) {
        return new Response("Gateway Timeout", { status: 504 });
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await testFetchScopedPendingAnnotations(workspace);
    expect(res.annotations).toHaveLength(1);
    expect(res.successSessions).toEqual(["session-good"]);
    expect(res.failedSessions).toHaveLength(1);
    expect(res.failedSessions[0].sessionId).toBe("session-bad");

    const handleRes = await testHandleGetPendingAnnotations(workspace);
    expect((handleRes as { isError?: boolean }).isError).toBeFalsy();
    const parsed = JSON.parse(handleRes.content[0].text);
    expect(parsed.count).toBe(1);
    expect(parsed.partial).toBe(true);
    expect(parsed.failedSessions).toHaveLength(1);
    expect(parsed.failedSessions[0].sessionId).toBe("session-bad");
  });

  it("deduplicates annotations across multiple sessions", async () => {
    const db = getDb(workspace);
    dbSaveSessionMapping(db, "session-1", "client-x", workspace);
    dbSaveSessionMapping(db, "session-2", "client-x", workspace);

    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("/health")) {
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      if (urlStr.includes("session-1")) {
        return new Response(
          JSON.stringify([{ id: "ann-shared", comment: "Shared annotation" }]),
          { status: 200 },
        );
      }
      if (urlStr.includes("session-2")) {
        return new Response(
          JSON.stringify([
            { id: "ann-shared", comment: "Shared annotation duplicate" },
            { id: "ann-unique", comment: "Unique annotation" },
          ]),
          { status: 200 },
        );
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await testFetchScopedPendingAnnotations(workspace);
    expect(res.annotations).toHaveLength(2); // ann-shared and ann-unique
    const ids = res.annotations.map((a) => (a as { id: string }).id);
    expect(ids).toEqual(["ann-shared", "ann-unique"]);
  });

  it("accepts valid object containing an annotations array", async () => {
    const db = getDb(workspace);
    dbSaveSessionMapping(db, "session-obj", "client-x", workspace);

    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("session-obj")) {
        return new Response(
          JSON.stringify({
            annotations: [{ id: "ann-obj-1", comment: "Object-wrapped annotation" }],
          }),
          { status: 200 },
        );
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await testFetchScopedPendingAnnotations(workspace);
    expect(res.annotations).toHaveLength(1);
    expect(res.successSessions).toEqual(["session-obj"]);
    expect(res.failedSessions).toEqual([]);
    expect((res.annotations[0] as { id: string }).id).toBe("ann-obj-1");
  });

  it("treats malformed JSON and unexpected response shapes as session failures", async () => {
    const db = getDb(workspace);
    dbSaveSessionMapping(db, "session-malformed-json", "client-x", workspace);
    dbSaveSessionMapping(db, "session-unexpected-schema", "client-x", workspace);

    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("session-malformed-json")) {
        // HTTP 200 but broken JSON
        return new Response("{ invalid json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("session-unexpected-schema")) {
        // HTTP 200 but unexpected JSON shape (object without annotations array)
        return new Response(JSON.stringify({ error: "Something broke", code: 123 }), {
          status: 200,
        });
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await testFetchScopedPendingAnnotations(workspace);
    expect(res.annotations).toHaveLength(0);
    expect(res.successSessions).toHaveLength(0);
    expect(res.failedSessions).toHaveLength(2);
    expect(res.failedSessions.some((f) => f.sessionId === "session-malformed-json" && f.error.includes("Malformed JSON"))).toBe(true);
    expect(res.failedSessions.some((f) => f.sessionId === "session-unexpected-schema" && f.error.includes("Malformed upstream response schema"))).toBe(true);
  });

  it("treats HTTP 500, 503, and network timeouts as session failures", async () => {
    const db = getDb(workspace);
    dbSaveSessionMapping(db, "session-500", "client-x", workspace);
    dbSaveSessionMapping(db, "session-503", "client-x", workspace);
    dbSaveSessionMapping(db, "session-timeout", "client-x", workspace);

    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("session-500")) {
        return new Response("Server error", { status: 500 });
      }
      if (urlStr.includes("session-503")) {
        return new Response("Service unavailable", { status: 503 });
      }
      if (urlStr.includes("session-timeout")) {
        const timeoutErr = new Error("The operation was aborted due to timeout");
        timeoutErr.name = "TimeoutError";
        throw timeoutErr;
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await testFetchScopedPendingAnnotations(workspace);
    expect(res.annotations).toHaveLength(0);
    expect(res.successSessions).toHaveLength(0);
    expect(res.failedSessions).toHaveLength(3);
  });

  it("watchAnnotations surfaces total failure when all mapped sessions fail during watch", async () => {
    const { testHandleWatchAnnotations } = await import("../../src/mcp/server.js");
    const db = getDb(workspace);
    dbSaveSessionMapping(db, "session-watch-fail", "client-x", workspace);

    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("/health")) {
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      if (urlStr.includes("session-watch-fail")) {
        return new Response("Internal Server Error", { status: 500 });
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const watchRes = await testHandleWatchAnnotations(workspace, 1);
    expect((watchRes as { isError?: boolean }).isError).toBe(true);
    expect(watchRes.content[0].text).toContain("All mapped sessions failed during watch");
    expect(watchRes.content[0].text).toContain("session-watch-fail");
  });

  it("watchAnnotations reports partial failure when a healthy session is empty while another fails", async () => {
    const { testHandleWatchAnnotations } = await import("../../src/mcp/server.js");
    const db = getDb(workspace);
    dbSaveSessionMapping(db, "session-watch-healthy-empty", "client-x", workspace);
    dbSaveSessionMapping(db, "session-watch-error", "client-x", workspace);

    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("/health")) {
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      if (urlStr.includes("session-watch-healthy-empty")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (urlStr.includes("session-watch-error")) {
        return new Response("Bad Gateway", { status: 502 });
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const watchRes = await testHandleWatchAnnotations(workspace, 1);
    // Not a fatal total error because healthy session succeeded, but partial failure is surfaced
    expect((watchRes as { isError?: boolean }).isError).toBeFalsy();
    const parsed = JSON.parse(watchRes.content[0].text);
    expect(parsed.annotations).toEqual([]);
    expect(parsed.partial).toBe(true);
    expect(parsed.failedSessions).toHaveLength(1);
    expect(parsed.failedSessions[0].sessionId).toBe("session-watch-error");
  });

  it("unauthorized local legacy mapping is filtered out and never queried upstream", async () => {
    const db = getDb(workspace);
    // Directly insert row into session_mappings without global claim
    db.prepare(
      "INSERT OR REPLACE INTO session_mappings VALUES ('session-unauthorized', 'client-x', ?, ?)",
    ).run(workspace, new Date().toISOString());

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;

    const res = await testFetchScopedPendingAnnotations(workspace);
    expect(res.annotations).toEqual([]);
    expect(res.successSessions).toEqual([]);
    expect(fetchCalled).toBe(false); // Invariant: never queried upstream!
  });
});
