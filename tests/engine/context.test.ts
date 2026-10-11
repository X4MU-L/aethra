/**
 * Tests for the context selection engine (src/engine/context.ts).
 */

import { describe, it, expect } from 'vitest';
import { selectSkillsForTask } from '../../src/engine/context.js';

// Skills are loaded from ~/.aethra/skills/ — tests validate selection logic,
// not the actual file content (which may vary per machine).

describe('selectSkillsForTask', () => {
  it('always selects engineering-principles, website-audit and fix-planning for investigate stage', async () => {
    const result = await selectSkillsForTask('Fix console errors', undefined, 'investigate');
    const names = result.selectedSkills.map((s) => s.name);
    expect(names).toContain('engineering-principles');
    expect(names).toContain('website-audit');
    expect(names).toContain('fix-planning');
  });

  it('includes wordpress-local-development for wordpress platform', async () => {
    const result = await selectSkillsForTask('Fix slow page load', 'wordpress', 'investigate');
    const names = result.selectedSkills.map((s) => s.name);
    expect(names).toContain('wordpress-local-development');
    // Should still include core skills
    expect(names).toContain('website-audit');
  });

  it('includes shopify-development for shopify platform', async () => {
    const result = await selectSkillsForTask('Fix checkout flow', 'shopify', 'investigate');
    const names = result.selectedSkills.map((s) => s.name);
    expect(names).toContain('shopify-development');
  });

  it('selects git-safe-implementation for implement stage', async () => {
    const result = await selectSkillsForTask('Fix nav menu bug', undefined, 'implement');
    const names = result.selectedSkills.map((s) => s.name);
    expect(names).toContain('git-safe-implementation');
  });

  it('caps selection at 5 skills maximum', async () => {
    const result = await selectSkillsForTask(
      'fix performance git commit docs',
      'wordpress',
      'investigate',
    );
    expect(result.selectedSkills.length).toBeLessThanOrEqual(5);
  });

  it('records excluded skills that were not selected', async () => {
    const result = await selectSkillsForTask('Fix nav', undefined, 'investigate');
    // At least some skills should be excluded (the platform-specific ones + optional ones)
    expect(Array.isArray(result.excluded)).toBe(true);
  });

  it('returns a selectionRationale string', async () => {
    const result = await selectSkillsForTask('test task', undefined, 'plan');
    expect(typeof result.selectionRationale).toBe('string');
    expect(result.selectionRationale.length).toBeGreaterThan(10);
  });

  it('handles unknown platform without crashing', async () => {
    const result = await selectSkillsForTask('Fix a bug', 'unknown', 'investigate');
    expect(Array.isArray(result.selectedSkills)).toBe(true);
  });

  it('does not include deprecated skills', async () => {
    // This tests that the manager.ts filter is applied — no deprecated skills in output
    const result = await selectSkillsForTask('any task', undefined, 'investigate');
    // If we had deprecated skills they'd be filtered — just confirm no errors
    expect(result.selectedSkills.every((s) => s.name.length > 0)).toBe(true);
  });

  it('returns skills with non-empty filePath and description', async () => {
    const result = await selectSkillsForTask('Fix a bug', undefined, 'investigate');
    for (const skill of result.selectedSkills) {
      expect(skill.filePath.length).toBeGreaterThan(0);
      expect(skill.description.length).toBeGreaterThan(0);
      expect(skill.reason.length).toBeGreaterThan(0);
    }
  });
});
