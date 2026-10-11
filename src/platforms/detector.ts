/**
 * Platform detection engine.
 * Identifies the technology stack of a website or local repository.
 * Returns a confidence score and evidence list, not just an assertion.
 */

import path from 'path';
import { expandPath, pathExists, readFile } from '../engine/fs.js';
import type { PlatformDetection, PlatformType } from '../core/schemas.js';

interface DetectionSignal {
  platform: PlatformType;
  weight: number;
  evidence: string;
}

/** Detect the platform of a local repository directory. */
export async function detectPlatformFromDirectory(
  repoPath: string,
): Promise<PlatformDetection> {
  const resolved = expandPath(repoPath);
  const signals: DetectionSignal[] = [];

  await Promise.all([
    checkPackageJson(resolved, signals),
    checkWordPressFiles(resolved, signals),
    checkShopifyFiles(resolved, signals),
    checkNextJs(resolved, signals),
    checkComposer(resolved, signals),
  ]);

  return computeDetection(signals);
}

/** Detect the platform from HTTP response headers and HTML content. */
export function detectPlatformFromHttpSignals(
  headers: Record<string, string>,
  htmlSnippet: string,
  detectedTechnologies: string[],
): PlatformDetection {
  const signals: DetectionSignal[] = [];

  // WordPress signals
  if (htmlSnippet.includes('/wp-content/') || htmlSnippet.includes('/wp-includes/')) {
    signals.push({ platform: 'wordpress', weight: 0.9, evidence: 'wp-content/wp-includes paths in HTML' });
  }
  if (headers['x-powered-by']?.toLowerCase().includes('wordpress')) {
    signals.push({ platform: 'wordpress', weight: 0.95, evidence: 'X-Powered-By: WordPress header' });
  }
  if (htmlSnippet.match(/generator.*wordpress/i)) {
    signals.push({ platform: 'wordpress', weight: 0.95, evidence: 'WordPress generator meta tag' });
  }
  if (detectedTechnologies.some((t) => t.toLowerCase().includes('wordpress'))) {
    signals.push({ platform: 'wordpress', weight: 0.85, evidence: 'WordPress in detected technologies' });
  }

  // WooCommerce (requires WordPress)
  if (htmlSnippet.includes('woocommerce') || htmlSnippet.includes('/wc-')) {
    signals.push({ platform: 'woocommerce', weight: 0.8, evidence: 'WooCommerce class/path references in HTML' });
  }

  // Shopify signals
  if (headers['x-shopify-stage'] || headers['x-sorting-hat-shopid']) {
    signals.push({ platform: 'shopify', weight: 0.99, evidence: 'Shopify headers present' });
  }
  if (htmlSnippet.includes('cdn.shopify.com') || htmlSnippet.includes('myshopify.com')) {
    signals.push({ platform: 'shopify', weight: 0.95, evidence: 'Shopify CDN or domain reference in HTML' });
  }
  if (htmlSnippet.match(/shopify/i) && detectedTechnologies.some((t) => t.toLowerCase().includes('shopify'))) {
    signals.push({ platform: 'shopify', weight: 0.9, evidence: 'Shopify in detected technologies' });
  }

  // Next.js signals
  if (htmlSnippet.includes('__NEXT_DATA__') || htmlSnippet.includes('/_next/')) {
    signals.push({ platform: 'nextjs', weight: 0.95, evidence: '__NEXT_DATA__ or /_next/ paths in HTML' });
  }

  // Generic React signals
  if (htmlSnippet.includes('__reactFiber') || htmlSnippet.includes('data-reactroot')) {
    signals.push({ platform: 'react', weight: 0.8, evidence: 'React fiber or data-reactroot in HTML' });
  }

  return computeDetection(signals);
}

async function checkPackageJson(repoPath: string, signals: DetectionSignal[]): Promise<void> {
  const pkgPath = path.join(repoPath, 'package.json');
  if (!(await pathExists(pkgPath))) return;

  try {
    const content = await readFile(pkgPath);
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };

    if ('next' in allDeps) {
      signals.push({ platform: 'nextjs', weight: 0.9, evidence: 'next in package.json' });
    }
    if ('react' in allDeps) {
      signals.push({ platform: 'react', weight: 0.6, evidence: 'react in package.json' });
    }
    if ('@shopify/cli' in allDeps || '@shopify/theme' in allDeps) {
      signals.push({ platform: 'shopify', weight: 0.85, evidence: 'Shopify packages in package.json' });
    }
  } catch {
    // Parse failure — skip
  }
}

async function checkWordPressFiles(repoPath: string, signals: DetectionSignal[]): Promise<void> {
  const wpFiles = ['wp-config.php', 'wp-login.php', 'wp-includes'];
  for (const file of wpFiles) {
    if (await pathExists(path.join(repoPath, file))) {
      signals.push({ platform: 'wordpress', weight: 0.9, evidence: `${file} found` });
      return;
    }
  }
  // Check for theme structure (wp-content/themes/*)
  const themeDir = path.join(repoPath, 'wp-content', 'themes');
  if (await pathExists(themeDir)) {
    signals.push({ platform: 'wordpress', weight: 0.85, evidence: 'wp-content/themes directory found' });
  }
}

async function checkShopifyFiles(repoPath: string, signals: DetectionSignal[]): Promise<void> {
  // Shopify theme structure
  const shopifyDirs = ['templates', 'sections', 'snippets', 'assets', 'layout', 'locales'];
  const shopifyConfigFile = path.join(repoPath, '.shopify-cli.yml');
  const shopifyToml = path.join(repoPath, 'shopify.app.toml');

  if (await pathExists(shopifyConfigFile)) {
    signals.push({ platform: 'shopify', weight: 0.95, evidence: '.shopify-cli.yml found' });
    return;
  }
  if (await pathExists(shopifyToml)) {
    signals.push({ platform: 'shopify', weight: 0.95, evidence: 'shopify.app.toml found' });
    return;
  }

  let shopifyDirCount = 0;
  for (const dir of shopifyDirs) {
    if (await pathExists(path.join(repoPath, dir))) shopifyDirCount++;
  }
  if (shopifyDirCount >= 4) {
    signals.push({
      platform: 'shopify',
      weight: 0.7,
      evidence: `${shopifyDirCount}/${shopifyDirs.length} Shopify theme directories found`,
    });
  }
}

async function checkNextJs(repoPath: string, signals: DetectionSignal[]): Promise<void> {
  if (await pathExists(path.join(repoPath, 'next.config.js'))) {
    signals.push({ platform: 'nextjs', weight: 0.95, evidence: 'next.config.js found' });
  }
  if (await pathExists(path.join(repoPath, 'next.config.ts'))) {
    signals.push({ platform: 'nextjs', weight: 0.95, evidence: 'next.config.ts found' });
  }
}

async function checkComposer(repoPath: string, signals: DetectionSignal[]): Promise<void> {
  const composerPath = path.join(repoPath, 'composer.json');
  if (!(await pathExists(composerPath))) return;

  try {
    const content = await readFile(composerPath);
    const composer = JSON.parse(content) as {
      require?: Record<string, string>;
    };
    const deps = composer.require ?? {};

    if ('roots/wordpress' in deps || 'johnpbloch/wordpress' in deps) {
      signals.push({ platform: 'wordpress', weight: 0.9, evidence: 'WordPress in composer.json require' });
    }
    if ('woocommerce/woocommerce' in deps || Object.keys(deps).some((k) => k.includes('woocommerce'))) {
      signals.push({ platform: 'woocommerce', weight: 0.85, evidence: 'WooCommerce in composer.json' });
    }
  } catch {
    // Skip
  }
}

function computeDetection(signals: DetectionSignal[]): PlatformDetection {
  if (signals.length === 0) {
    return {
      platform: 'unknown',
      confidence: 0,
      evidence: ['No platform signals detected'],
      detectedAt: new Date().toISOString(),
    };
  }

  // Aggregate scores by platform
  const scores: Map<PlatformType, { total: number; evidence: string[] }> = new Map();

  for (const signal of signals) {
    const existing = scores.get(signal.platform) ?? { total: 0, evidence: [] };
    // Use probabilistic combination to avoid exceeding 1.0
    existing.total = 1 - (1 - existing.total) * (1 - signal.weight);
    existing.evidence.push(signal.evidence);
    scores.set(signal.platform, existing);
  }

  // WooCommerce implies WordPress — elevate wordpress if woocommerce detected
  if (scores.has('woocommerce')) {
    const wp = scores.get('wordpress') ?? { total: 0, evidence: [] };
    const woo = scores.get('woocommerce')!;
    wp.total = Math.max(wp.total, woo.total * 0.95);
    wp.evidence.push('WooCommerce detected (implies WordPress)');
    scores.set('wordpress', wp);
  }

  // Find the top platform
  let topPlatform: PlatformType = 'unknown';
  let topScore = 0;
  let topEvidence: string[] = [];

  for (const [platform, { total, evidence }] of scores) {
    if (total > topScore) {
      topScore = total;
      topPlatform = platform;
      topEvidence = evidence;
    }
  }

  return {
    platform: topScore > 0.5 ? topPlatform : 'unknown',
    confidence: Math.min(topScore, 1),
    evidence: topEvidence,
    detectedAt: new Date().toISOString(),
  };
}
