/**
 * Cart utilities for a Next.js e-commerce storefront.
 *
 * BUG: applyDiscount returns the discount amount instead of the post-discount price.
 * Example: applyDiscount(100, 0.2) returns 20 (the discount) not 80 (what the customer pays).
 */

/** Apply a percentage discount rate to a price. Returns the discounted price. */
export function applyDiscount(price: number, rate: number): number {
  // BUG: should be price * (1 - rate)
  return price * rate;
}

/** Sum items and apply an optional promo discount rate. */
export function cartTotal(items: number[], promoRate = 0): number {
  const subtotal = items.reduce((sum, p) => sum + p, 0);
  if (promoRate === 0) return subtotal;
  return applyDiscount(subtotal, promoRate);
}
