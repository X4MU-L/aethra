/**
 * Tests for the client facts parser.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { parseFactsDirectory, validateFacts, deriveSlug, derivePrimaryUrl } from '../../src/engine/facts-parser.js';

const SYNTHETIC_FACTS_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../fixtures/synthetic-client',
);

describe('deriveSlug', () => {
  it('converts client name to slug', () => {
    expect(deriveSlug('EkeBoss Restaurant')).toBe('ekeboss-restaurant');
    expect(deriveSlug('Acme Corp & Associates')).toBe('acme-corp-associates');
    expect(deriveSlug('My Client 123')).toBe('my-client-123');
  });

  it('handles special characters', () => {
    expect(deriveSlug('Test — Client (Ltd)')).toBe('test-client-ltd');
  });

  it('trims leading/trailing hyphens', () => {
    expect(deriveSlug('   Spaces   ')).not.toMatch(/^-|-$/);
  });
});

describe('derivePrimaryUrl', () => {
  it('returns the first apex domain', () => {
    const urls = [
      'https://ekeboss.example.com',
      'https://ekeboss.example.com/menu',
      'https://ekeboss.example.com/about',
    ];
    const result = derivePrimaryUrl(urls);
    expect(result).toBe('https://ekeboss.example.com');
  });

  it('returns undefined for no valid apex URLs', () => {
    const result = derivePrimaryUrl([]);
    expect(result).toBeUndefined();
  });
});

describe('parseFactsDirectory', () => {
  it('parses the synthetic client facts directory', async () => {
    const result = await parseFactsDirectory(SYNTHETIC_FACTS_DIR);

    expect(result.facts.name).toBeDefined();
    expect(result.sourceFiles.length).toBeGreaterThan(0);
  }, 10000);

  it('extracts URLs from known-urls.txt', async () => {
    const result = await parseFactsDirectory(SYNTHETIC_FACTS_DIR);
    expect(result.facts.knownUrls).toBeDefined();
    expect(result.facts.knownUrls!.length).toBeGreaterThan(0);
  });

  it('handles non-existent directory gracefully', async () => {
    const result = await parseFactsDirectory('/tmp/nonexistent-facts-dir-aethra');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.facts.objectives).toEqual([]);
  });
});

describe('validateFacts', () => {
  it('derives slug from name when not provided', () => {
    const result = validateFacts({ name: 'EkeBoss Restaurant' });
    expect(result.facts.slug).toBe('ekeboss-restaurant');
  });

  it('derives primary URL from knownUrls', () => {
    const result = validateFacts({
      name: 'Test',
      slug: 'test',
      knownUrls: ['https://test.example.com', 'https://test.example.com/about'],
    });
    expect(result.facts.primaryUrl).toBe('https://test.example.com');
  });

  it('reports missing name as unknown', () => {
    const result = validateFacts({});
    expect(result.unknowns).toContain('client name');
  });
});
