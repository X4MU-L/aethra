/**
 * Cart utilities for a Next.js e-commerce storefront.
 *
 * FIXED: applyDiscount now returns price * (1 - rate) — the price after discount.
 */

/** Apply a percentage discount rate to a price. Returns the discounted price. */
export function applyDiscount(price: number, rate: number): number {
  return price * (1 - rate);
}

/** Sum items and apply an optional promo discount rate. */
export function cartTotal(items: number[], promoRate = 0): number {
  const subtotal = items.reduce((sum, p) => sum + p, 0);
  if (promoRate === 0) return subtotal;
  return applyDiscount(subtotal, promoRate);
}
