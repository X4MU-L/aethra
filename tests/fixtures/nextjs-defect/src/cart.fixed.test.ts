/**
 * Tests against the FIXED implementation (cart.fixed.ts).
 * Importing from cart.fixed.js proves the correct logic works.
 * Used by the E2E workflow test to verify the "after fix" state.
 */

import { describe, it, expect } from 'vitest';
import { applyDiscount, cartTotal } from './cart.fixed.js';

describe('applyDiscount (fixed)', () => {
  it('returns the price after discount, not the discount amount', () => {
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

describe('cartTotal (fixed)', () => {
  it('sums items without a promo code', () => {
    expect(cartTotal([10, 20, 30])).toBe(60);
  });

  it('applies promo code to total', () => {
    expect(cartTotal([30, 70], 0.1)).toBe(90);
  });

  it('zero promo rate leaves total unchanged', () => {
    expect(cartTotal([25, 75], 0)).toBe(100);
  });
});
