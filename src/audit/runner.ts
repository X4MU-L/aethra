/**
 * Audit runner — orchestrates the full audit workflow.
 * Deterministic: runs checks, collects evidence, produces structured JSON.
 * Does NOT modify source files. Does NOT commit or push anything.
 */

import path from "path";
import crypto from "crypto";
import os from "os";
import { writeJson, ensureDir, pathExists, readJson } from "../engine/fs.js";
import {
  isPlaywrightAvailable,
  inspectPage,
  httpCheck,
  runLighthouse,
} from "../browser/engine.js";
import { detectPlatformFromHttpSignals } from "../platforms/detector.js";
import { updateTechnicalFindings } from "../engine/workspace.js";
import { logger } from "../core/logger.js";
import type {
  AuditRun,
  ClientConfig,
  Finding,
  EvidenceItem,
} from "../core/schemas.js";
import { getVersion } from "../engine/subprocess.js";

export interface AuditOptions {
  type?: "baseline" | "refresh" | "local";
  urlOverride?: string;
  maxPages?: number;
  timeoutMs?: number;
  runLighthouseAudit?: boolean;
  runAccessibility?: boolean;
  captureScreenshots?: boolean;
}

/** Run a full audit for a client. */
export async function runAudit(
  config: ClientConfig,
  workspacePath: string,
  opts: AuditOptions = {},
): Promise<AuditRun> {
  const auditId = crypto.randomBytes(8).toString("hex");
  const startedAt = new Date().toISOString();
  const type = opts.type ?? "baseline";
  const evidenceDir = path.join(workspacePath, "evidence");
  // Use run-specific subdirectories to avoid overwriting evidence across audit types/runs
  const screenshotDir = path.join(
    evidenceDir,
    "screenshots",
    `${type}-${auditId}`,
  );
  const perfDir = path.join(evidenceDir, "performance");
  const accessDir = path.join(evidenceDir, "accessibility");

  await ensureDir(screenshotDir);
  await ensureDir(perfDir);
  await ensureDir(accessDir);

  // Resolve the audit URL: explicit override → local config (for 'local' type) → primary URL
  const auditUrl: string | undefined =
    opts.urlOverride ??
    (type === "local"
      ? (config.localUrl ?? config.primaryUrl)
      : config.primaryUrl);

  const playwrightAvailable = await isPlaywrightAvailable();
  const nodeVersion = process.version;
  const playwrightVersion = playwrightAvailable
    ? ((await getVersion("npx", "playwright@latest --version").catch(
        () => null,
      )) ?? undefined)
    : undefined;

  const auditRun: AuditRun = {
    id: auditId,
    clientSlug: config.slug,
    type,
    startedAt,
    status: "running",
    targetUrl: auditUrl,
    pagesInspected: [],
    findings: [],
    artifactManifest: [],
    errors: [],
    limitations: [],
    environment: {
      os: `${os.type()} ${os.release()} (${os.arch()})`,
      nodeVersion,
      playwrightVersion,
      note:
        type === "local"
          ? "Local development audit. Results reflect local server state, not production."
          : "Lab results only. Field data requires real user measurement.",
    },
  };

  if (!playwrightAvailable) {
    auditRun.limitations.push(
      "Playwright not installed — screenshot capture and browser inspection unavailable. " +
        "Run: npm install playwright && npx playwright install chromium",
    );
  }

  if (!auditUrl) {
    if (type === "local") {
      auditRun.errors.push(
        "No local URL configured. Run: aethra workspace set-local <url>  " +
          "or pass one directly: aethra audit --local http://localhost:3000",
      );
    } else {
      auditRun.errors.push(
        "No primary URL configured. Set primaryUrl in client.yaml.",
      );
    }
    auditRun.status = "partial";
    await saveAuditRun(auditRun, evidenceDir);
    return auditRun;
  }

  // ── Stage 1: HTTP check ──────────────────────────────────────────────────
  logger.info(`HTTP check: ${auditUrl}`);
  const httpResult = await httpCheck(auditUrl, opts.timeoutMs ?? 15000);
  const httpEvidence: EvidenceItem = {
    path: path.join(evidenceDir, "logs", `http-check-${auditId}.json`),
    type: "http-check",
    description: `HTTP check for ${auditUrl}`,
    capturedAt: new Date().toISOString(),
    url: auditUrl,
  };

  await ensureDir(path.join(evidenceDir, "logs"));
  await writeJson(httpEvidence.path, httpResult);
  auditRun.artifactManifest.push(httpEvidence);

  if (!httpResult.reachable) {
    auditRun.errors.push(
      `URL not reachable: ${httpResult.error ?? `HTTP ${httpResult.status}`}`,
    );
    auditRun.status = "partial";
    await saveAuditRun(auditRun, evidenceDir);
    return auditRun;
  }

  if (httpResult.redirectedTo) {
    logger.info(`Redirected to: ${httpResult.redirectedTo}`);
  }

  // ── Stage 2: Platform detection from headers ──────────────────────────────
  const detection = detectPlatformFromHttpSignals(
    httpResult.headers ?? {},
    "",
    [],
  );
  logger.info(
    `Platform detection: ${detection.platform} (${Math.round(detection.confidence * 100)}% confidence)`,
  );

  const detectionEvidence: EvidenceItem = {
    path: path.join(evidenceDir, "logs", `platform-detection-${auditId}.json`),
    type: "platform-detection",
    description: "Platform detection from HTTP headers",
    capturedAt: new Date().toISOString(),
    url: auditUrl,
  };
  await writeJson(detectionEvidence.path, detection);
  auditRun.artifactManifest.push(detectionEvidence);

  if (detection.confidence > 0.5) {
    auditRun.findings.push(
      buildFinding(
        `Platform detected: ${detection.platform}`,
        "platform",
        "info",
        `Detected platform is ${detection.platform} with ${Math.round(detection.confidence * 100)}% confidence.`,
        detection.evidence,
        detectionEvidence,
      ),
    );
  }

  // ── Stage 3: Browser inspection ────────────────────────────────────────────
  // For local audits: only inspect the local URL (importantPages are production URLs)
  // For production audits: deduplicate importantPages against primaryUrl
  let targetPages: string[];
  if (type === "local") {
    targetPages = [auditUrl];
  } else {
    const rawPages = [auditUrl, ...(config.auditSettings.importantPages ?? [])];
    const seenUrls = new Set<string>();
    targetPages = rawPages
      .filter((u) => {
        // Normalise trailing slash for deduplication
        const normalised = u.replace(/\/$/, "");
        if (seenUrls.has(normalised)) return false;
        seenUrls.add(normalised);
        return true;
      })
      .slice(0, opts.maxPages ?? config.auditSettings.maxPages ?? 10);
  }

  if (playwrightAvailable && opts.captureScreenshots !== false) {
    for (const pageUrl of targetPages) {
      logger.info(`Inspecting: ${pageUrl}`);
      try {
        const inspection = await inspectPage(
          pageUrl,
          screenshotDir,
          { timeoutMs: opts.timeoutMs ?? 30000 },
          config.auditSettings.viewports ?? [
            { name: "desktop", width: 1440, height: 900 },
            { name: "mobile", width: 375, height: 812 },
          ],
        );

        auditRun.pagesInspected.push(pageUrl);

        // Add screenshot evidence
        for (const [viewportName, screenshotPath] of Object.entries(
          inspection.screenshots,
        )) {
          auditRun.artifactManifest.push({
            path: screenshotPath,
            type: "screenshot",
            description: `${viewportName} screenshot of ${pageUrl}`,
            capturedAt: new Date().toISOString(),
            url: pageUrl,
            viewport: viewportName,
          });
        }

        // Add page inspection evidence
        const inspectionPath = path.join(
          evidenceDir,
          "browser-tests",
          `page-inspection-${sanitiseForFilename(pageUrl)}-${auditId}.json`,
        );
        await ensureDir(path.join(evidenceDir, "browser-tests"));
        await writeJson(inspectionPath, inspection);
        auditRun.artifactManifest.push({
          path: inspectionPath,
          type: "browser-test",
          url: pageUrl,
          capturedAt: new Date().toISOString(),
        });

        // Re-detect platform from HTML content
        if (inspection.title) {
          const htmlDetection = detectPlatformFromHttpSignals(
            {},
            inspection.h1.join(" "),
            [],
          );
          if (htmlDetection.confidence > detection.confidence) {
            logger.info(
              `Updated platform detection from HTML: ${htmlDetection.platform}`,
            );
          }
        }

        // Collect findings from console errors
        if (inspection.consoleErrors.length > 0) {
          auditRun.findings.push(
            buildFinding(
              `Console errors on ${pageUrl}`,
              "technical",
              inspection.consoleErrors.length > 5 ? "high" : "medium",
              `${inspection.consoleErrors.length} console error(s) detected.`,
              inspection.consoleErrors.slice(0, 5),
              { path: inspectionPath, type: "browser-test", url: pageUrl },
            ),
          );
        }

        // Add artificial delay between pages (rate limiting)
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        const errMsg = (err as Error).message;
        auditRun.errors.push(`Failed to inspect ${pageUrl}: ${errMsg}`);
        logger.warn(`Inspection failed for ${pageUrl}: ${errMsg}`);
      }
    }
  }

  // ── Stage 4: Lighthouse ────────────────────────────────────────────────────
  if (opts.runLighthouseAudit !== false && config.auditSettings.runLighthouse) {
    logger.info(`Running Lighthouse on ${auditUrl}`);
    const lhResult = await runLighthouse(auditUrl, perfDir);

    if (lhResult.success && lhResult.reportPath) {
      auditRun.artifactManifest.push({
        path: lhResult.reportPath,
        type: "lighthouse",
        description: `Lighthouse audit of ${auditUrl}`,
        capturedAt: new Date().toISOString(),
        url: auditUrl,
      });

      if (lhResult.scores) {
        logger.success(`Lighthouse scores: ${JSON.stringify(lhResult.scores)}`);

        // Generate findings from poor scores
        for (const [category, score] of Object.entries(lhResult.scores)) {
          if (score < 50) {
            auditRun.findings.push(
              buildFinding(
                `Poor Lighthouse ${category} score: ${score}/100`,
                "performance",
                "high",
                `Lighthouse ${category} score is ${score}/100. Lab environment; field data may differ.`,
                [`Score: ${score}/100`],
                {
                  path: lhResult.reportPath,
                  type: "lighthouse",
                  url: auditUrl,
                },
              ),
            );
          } else if (score < 75) {
            auditRun.findings.push(
              buildFinding(
                `Below-target Lighthouse ${category} score: ${score}/100`,
                "performance",
                "medium",
                `Lighthouse ${category} score is ${score}/100. Consider reviewing.`,
                [`Score: ${score}/100`],
                {
                  path: lhResult.reportPath,
                  type: "lighthouse",
                  url: auditUrl,
                },
              ),
            );
          }
        }
      }
    } else {
      auditRun.limitations.push(`Lighthouse audit failed: ${lhResult.error}`);
      logger.warn(`Lighthouse failed: ${lhResult.error}`);
    }
  }

  // ── Complete ───────────────────────────────────────────────────────────────
  auditRun.completedAt = new Date().toISOString();
  auditRun.status = auditRun.errors.length > 0 ? "partial" : "completed";

  await saveAuditRun(auditRun, evidenceDir);

  // Dual-write to SQLite for indexed queries
  try {
    const { getDb, dbSaveAuditRun, dbSaveFindings } =
      await import("../engine/db.js");
    const db = getDb(workspacePath);
    dbSaveAuditRun(db, auditRun);
    if (auditRun.findings.length > 0) {
      dbSaveFindings(db, auditRun.id, auditRun.findings);
    }
  } catch {
    // SQLite persistence is supplementary — don't fail the audit
    logger.warn("Could not persist audit run to database");
  }

  // Update knowledge/technical-findings.md with live results
  try {
    await updateTechnicalFindings(workspacePath, auditRun);
  } catch (err) {
    logger.warn(
      `Could not update technical-findings.md: ${(err as Error).message}`,
    );
  }

  logger.success(
    `Audit ${auditId} complete. ${auditRun.findings.length} findings. ${auditRun.artifactManifest.length} artifacts.`,
  );

  return auditRun;
}

/** Save an audit run to the evidence directory. */
async function saveAuditRun(
  run: AuditRun,
  evidenceDir: string,
): Promise<string> {
  const runPath = path.join(evidenceDir, `audit-${run.id}.json`);
  await writeJson(runPath, run);

  // Also write/overwrite the latest baseline or refresh pointer
  const pointerPath = path.join(evidenceDir, `${run.type}.json`);
  await writeJson(pointerPath, {
    auditId: run.id,
    path: runPath,
    completedAt: run.completedAt,
  });

  logger.debug(`Audit run saved: ${runPath}`);
  return runPath;
}

/** Load the latest audit run of a given type. */
export async function loadLatestAudit(
  evidenceDir: string,
  type: "baseline" | "refresh" | "local" = "baseline",
): Promise<AuditRun | null> {
  const pointerPath = path.join(evidenceDir, `${type}.json`);
  if (!(await pathExists(pointerPath))) return null;

  try {
    const pointer = await readJson<{ path: string }>(pointerPath);
    if (!(await pathExists(pointer.path))) return null;
    return await readJson<AuditRun>(pointer.path);
  } catch {
    return null;
  }
}

function buildFinding(
  title: string,
  category: string,
  severity: Finding["severity"],
  description: string,
  evidenceList: string[],
  primaryEvidence: Partial<EvidenceItem>,
): Finding {
  return {
    id: `finding-${crypto.randomBytes(4).toString("hex")}`,
    category,
    severity,
    title,
    description,
    status: "observed",
    evidence: [
      {
        path: primaryEvidence.path ?? "",
        type: primaryEvidence.type ?? "browser-test",
        description: evidenceList.join("; ").slice(0, 200),
        capturedAt: new Date().toISOString(),
        url: primaryEvidence.url,
        viewport: primaryEvidence.viewport,
      },
    ],
    verificationRequired: true,
    createdAt: new Date().toISOString(),
  };
}

function sanitiseForFilename(url: string): string {
  try {
    const p = new URL(url);
    return (p.hostname + p.pathname).replace(/[^a-zA-Z0-9]/g, "-").slice(0, 40);
  } catch {
    return url.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 40);
  }
}
