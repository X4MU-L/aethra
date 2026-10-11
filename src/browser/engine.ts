/**
 * Browser automation engine built on Playwright.
 * All browser operations go through here.
 *
 * Authentication safety:
 * - Auth state is stored ONLY in .local/ (gitignored)
 * - Credentials are never logged
 * - Sessions are never shared between clients
 * - Interactive login is prompted when needed — never automated
 */

import path from 'path';
import { ensureDir, pathExists } from '../engine/fs.js';
import { logger } from '../core/logger.js';
import type { PageInspection, HttpCheckResult } from '../core/schemas.js';

export interface BrowserConfig {
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  timeoutMs?: number;
  authStatePath?: string; // Path to stored auth state (in .local/ only)
}

export interface ViewportConfig {
  name: string;
  width: number;
  height: number;
}

export const DEFAULT_VIEWPORTS: ViewportConfig[] = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
];

/** Check if Playwright is available in the current environment. */
export async function isPlaywrightAvailable(): Promise<boolean> {
  try {
    await import('playwright');
    return true;
  } catch {
    return false;
  }
}

/**
 * Inspect a page and collect evidence.
 * Captures screenshots, console errors, network errors, links, forms.
 */
export async function inspectPage(
  url: string,
  outputDir: string,
  config: BrowserConfig = {},
  viewports: ViewportConfig[] = [DEFAULT_VIEWPORTS[0]!],
): Promise<PageInspection> {
  const { chromium, firefox, webkit } = await import('playwright');
  const browsers = { chromium, firefox, webkit };
  const browserType = browsers[config.browser ?? 'chromium'];

  const browser = await browserType.launch({ headless: config.headless ?? true });

  try {
    await ensureDir(outputDir);
    const screenshots: Record<string, string> = {};
    const consoleErrors: string[] = [];
    const networkErrors: string[] = [];
    let pageData: Omit<PageInspection, 'inspectedAt' | 'screenshots' | 'consoleErrors' | 'networkErrors'> | null = null;

    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        storageState: config.authStatePath
          ? (await pathExists(config.authStatePath) ? config.authStatePath : undefined)
          : undefined,
      });

      const page = await context.newPage();

      // Collect console errors (avoid logging sensitive content)
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text().slice(0, 500); // Truncate for safety
          if (!consoleErrors.includes(text)) consoleErrors.push(text);
        }
      });

      // Collect failed requests
      page.on('requestfailed', (req) => {
        const failure = `${req.method()} ${req.url().slice(0, 200)}: ${req.failure()?.errorText ?? 'unknown'}`;
        if (!networkErrors.includes(failure)) networkErrors.push(failure);
      });

      try {
        await page.goto(url, {
          timeout: config.timeoutMs ?? 30000,
          waitUntil: 'networkidle',
        });

        // Capture screenshot
        const screenshotName = `${viewport.name}-${sanitiseFilename(url)}.png`;
        const screenshotPath = path.join(outputDir, screenshotName);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        screenshots[viewport.name] = screenshotPath;
        logger.success(`Screenshot: ${screenshotPath}`);

        // Collect page data (once, from desktop or first viewport)
        if (!pageData) {
          pageData = await extractPageData(page, url);
        }
      } catch (err) {
        logger.warn(`Could not inspect ${url} at ${viewport.name}: ${(err as Error).message}`);
        networkErrors.push(`Navigation failed at ${viewport.name}: ${(err as Error).message}`);
      } finally {
        await context.close();
      }
    }

    return {
      url,
      title: pageData?.title,
      description: pageData?.description,
      h1: pageData?.h1 ?? [],
      headings: pageData?.headings ?? [],
      canonicalUrl: pageData?.canonicalUrl,
      ogTags: pageData?.ogTags,
      links: pageData?.links ?? { internal: [], external: [], broken: [] },
      forms: pageData?.forms ?? [],
      consoleErrors,
      networkErrors,
      screenshots,
      inspectedAt: new Date().toISOString(),
    };
  } finally {
    await browser.close();
  }
}

// Type alias for Playwright Page (avoid complex generic)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlaywrightPage = any;

/** Extract page metadata and structure using individual Playwright locator queries.
 *  Avoids page.evaluate() which has issues with esbuild __name helpers. */
async function extractPageData(
  page: PlaywrightPage,
  pageUrl: string,
): Promise<Omit<PageInspection, 'inspectedAt' | 'screenshots' | 'consoleErrors' | 'networkErrors'>> {
  const urlOrigin = new URL(pageUrl).origin;

  // Use individual queries rather than page.evaluate() to avoid __name issues
  const [title, description, canonicalUrl] = await Promise.all([
    page.title().catch(() => ''),
    page.$eval('meta[name="description"]', (el: Element) => el.getAttribute('content') ?? '').catch(() => ''),
    page.$eval('link[rel="canonical"]', (el: Element) => el.getAttribute('href') ?? '').catch(() => ''),
  ]);

  const h1: string[] = await page.$$eval('h1', (els: Element[]) =>
    els.map((el) => (el.textContent ?? '').trim().slice(0, 200)),
  ).catch(() => []);

  const headings: Array<{ level: number; text: string }> = await page.$$eval(
    'h1,h2,h3,h4,h5,h6',
    (els: Element[]) => els.slice(0, 50).map((el) => ({
      level: parseInt(el.tagName[1] ?? '1', 10),
      text: (el.textContent ?? '').trim().slice(0, 200),
    })),
  ).catch(() => []);

  const allHrefs: string[] = await page.$$eval('a[href]', (els: Element[]) =>
    els.map((el) => el.getAttribute('href') ?? ''),
  ).catch(() => []);

  const internal: string[] = [];
  const external: string[] = [];
  const seen = new Set<string>();
  for (const href of allHrefs) {
    try {
      const abs = new URL(href, pageUrl).href;
      if (!seen.has(abs)) {
        seen.add(abs);
        if (abs.startsWith(urlOrigin) && internal.length < 100) internal.push(abs);
        else if (abs.startsWith('http') && external.length < 50) external.push(abs);
      }
    } catch { /* skip invalid URLs */ }
  }

  const forms = await page.$$eval('form', (formEls: HTMLFormElement[]) =>
    formEls.slice(0, 10).map((form) => ({
      action: form.getAttribute('action') ?? undefined,
      method: (form.getAttribute('method') ?? 'get').toUpperCase(),
      fields: Array.from(form.querySelectorAll('input,textarea,select'))
        .slice(0, 20)
        .map((el) => el.getAttribute('name') ?? el.getAttribute('type') ?? 'unknown'),
    })),
  ).catch(() => []);

  const ogTags: Record<string, string> = await page.$$eval(
    'meta[property^="og:"]',
    (els: Element[]) => {
      const tags: Record<string, string> = {};
      for (const el of els) {
        const prop = el.getAttribute('property') ?? '';
        const content = el.getAttribute('content') ?? '';
        if (prop && content) tags[prop] = content;
      }
      return tags;
    },
  ).catch(() => ({}));

  return {
    url: pageUrl,
    title,
    description: description || undefined,
    canonicalUrl: canonicalUrl || undefined,
    h1,
    headings,
    links: { internal, external, broken: [] },
    forms,
    ogTags,
  };
}

/** Perform a simple HTTP check without launching a browser. */
export async function httpCheck(url: string, timeoutMs = 10000): Promise<HttpCheckResult> {
  const start = Date.now();
  const checkedAt = new Date().toISOString();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Aethra-Workbench/0.1 (+https://aethrasolutions.com)',
      },
    });
    clearTimeout(timeout);

    const latencyMs = Date.now() - start;
    const finalUrl = response.url;

    return {
      url,
      status: response.status,
      redirectedTo: finalUrl !== url ? finalUrl : undefined,
      reachable: response.status < 500,
      latencyMs,
      checkedAt,
      headers: (() => {
        const hdrs: Record<string, string> = {};
        response.headers.forEach((v, k) => {
          if (!k.toLowerCase().includes('cookie')) hdrs[k] = v;
        });
        return hdrs;
      })(),
    };
  } catch (err) {
    return {
      url,
      reachable: false,
      error: (err as Error).message,
      checkedAt,
    };
  }
}

/** Sanitise a URL into a safe filename component. */
function sanitiseFilename(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = [parsed.hostname, parsed.pathname]
      .join('')
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 50);
    return parts;
  } catch {
    return url.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 50);
  }
}

/**
 * Run a Lighthouse audit on a URL.
 * Requires Lighthouse to be available via npx or globally.
 */
export async function runLighthouse(
  url: string,
  outputDir: string,
  categories: string[] = ['performance', 'accessibility', 'best-practices', 'seo'],
): Promise<{ success: boolean; reportPath?: string; scores?: Record<string, number>; error?: string }> {
  const { run } = await import('../engine/subprocess.js');
  const { ensureDir } = await import('../engine/fs.js');

  await ensureDir(outputDir);
  const outputFile = path.join(outputDir, `lighthouse-${Date.now()}.json`);

  try {
    const result = await run(
      'npx',
      [
        'lighthouse',
        url,
        '--output=json',
        `--output-path=${outputFile}`,
        `--only-categories=${categories.join(',')}`,
        '--chrome-flags=--headless --no-sandbox',
        '--quiet',
      ],
      { timeoutMs: 120000, allowFailure: true },
    );

    if (result.exitCode !== 0) {
      return { success: false, error: `Lighthouse exit code ${result.exitCode}: ${result.stderr.slice(0, 500)}` };
    }

    if (!(await pathExists(outputFile))) {
      return { success: false, error: 'Lighthouse did not produce an output file' };
    }

    // Parse scores from the report
    const { readJson } = await import('../engine/fs.js');
    const report = await readJson<{ categories?: Record<string, { score: number | null }> }>(outputFile);
    const scores: Record<string, number> = {};
    for (const [key, cat] of Object.entries(report.categories ?? {})) {
      if (cat.score !== null) scores[key] = Math.round(cat.score * 100);
    }

    return { success: true, reportPath: outputFile, scores };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
