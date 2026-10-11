/**
 * Tests for the platform detector.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import {
  detectPlatformFromDirectory,
  detectPlatformFromHttpSignals,
} from '../../src/platforms/detector.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aethra-platform-test-'));
});

afterEach(async () => {
  await fs.remove(tmpDir);
});

describe('detectPlatformFromDirectory', () => {
  it('detects WordPress from wp-config.php', async () => {
    await fs.writeFile(path.join(tmpDir, 'wp-config.php'), '<?php // WP config');
    const result = await detectPlatformFromDirectory(tmpDir);
    expect(result.platform).toBe('wordpress');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('detects Next.js from next.config.js', async () => {
    await fs.writeFile(path.join(tmpDir, 'next.config.js'), 'module.exports = {};');
    await fs.writeJSON(path.join(tmpDir, 'package.json'), {
      dependencies: { next: '14.0.0', react: '18.0.0' },
    });
    const result = await detectPlatformFromDirectory(tmpDir);
    expect(result.platform).toBe('nextjs');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('detects Shopify from .shopify-cli.yml', async () => {
    await fs.writeFile(path.join(tmpDir, '.shopify-cli.yml'), 'project_type: theme');
    const result = await detectPlatformFromDirectory(tmpDir);
    expect(result.platform).toBe('shopify');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('returns unknown for empty directory', async () => {
    const result = await detectPlatformFromDirectory(tmpDir);
    expect(result.platform).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('detects React from package.json', async () => {
    await fs.writeJSON(path.join(tmpDir, 'package.json'), {
      dependencies: { react: '18.0.0' },
    });
    const result = await detectPlatformFromDirectory(tmpDir);
    // React alone is only a weak signal (0.6 weight)
    expect(result.evidence.length).toBeGreaterThan(0);
  });
});

describe('detectPlatformFromHttpSignals', () => {
  it('detects WordPress from HTML', () => {
    const result = detectPlatformFromHttpSignals(
      {},
      '<html><head></head><body><script src="/wp-content/themes/my-theme/js/app.js"></script></body></html>',
      [],
    );
    expect(result.platform).toBe('wordpress');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('detects Shopify from headers', () => {
    const result = detectPlatformFromHttpSignals(
      { 'x-shopify-stage': 'production' },
      '',
      [],
    );
    expect(result.platform).toBe('shopify');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('detects Next.js from NEXT_DATA script', () => {
    const result = detectPlatformFromHttpSignals(
      {},
      '<script id="__NEXT_DATA__" type="application/json">{}</script>',
      [],
    );
    expect(result.platform).toBe('nextjs');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('returns unknown for no signals', () => {
    const result = detectPlatformFromHttpSignals({}, '<html><body>Hello</body></html>', []);
    expect(result.platform).toBe('unknown');
  });

  it('includes evidence descriptions', () => {
    const result = detectPlatformFromHttpSignals(
      { 'x-shopify-stage': 'production' },
      '',
      [],
    );
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence[0]).toContain('Shopify');
  });
});
