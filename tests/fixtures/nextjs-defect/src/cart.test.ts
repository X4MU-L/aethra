/**
 * Tests for cart.ts — proving the discount bug.
 *
 * These tests FAIL against the buggy cart.ts and PASS against cart.fixed.ts.
 * They are excluded from the main test run (vitest.config.ts: exclude fixtures/).
 * The testrunner engine uses these to demonstrate verify --run-tests behaviour.
 */

import { describe, it, expect } from 'vitest';
import { applyDiscount, cartTotal } from './cart.js';

describe('applyDiscount', () => {
  it('returns the price after discount, not the discount amount', () => {
    // 20% off £100 → customer pays £80, not £20
    expect(applyDiscount(100, 0.2)).toBe(80);
  });

  it('zero discount returns full price unchanged', () => {
    expect(applyDiscount(50, 0)).toBe(50);
  });

  it('100% discount returns zero', () => {
    expect(applyDiscount(200, 1)).toBe(0);
  });

  it('fractional rates are handled correctly', () => {
    // 15% off £60 → £51
    expect(applyDiscount(60, 0.15)).toBeCloseTo(51);
  });
});

describe('cartTotal', () => {
  it('sums items without a promo code', () => {
    expect(cartTotal([10, 20, 30])).toBe(60);
  });

  it('applies promo code to total', () => {
    // 10% off £100 cart → £90
    expect(cartTotal([30, 70], 0.1)).toBe(90);
  });

  it('zero promo rate leaves total unchanged', () => {
    expect(cartTotal([25, 75], 0)).toBe(100);
  });
});
