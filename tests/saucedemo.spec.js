// @ts-check
const { test, expect } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');
const ProductsPage = require('../pages/ProductsPage');
const CartPage = require('../pages/CartPage');
const CheckoutPage = require('../pages/CheckoutPage');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const STANDARD_USER = 'standard_user';
const PASSWORD = 'secret_sauce';

/**
 * Shared login step.  The LoginPage constructor wires up the self-healing
 * wrapper, so every subsequent getByRole / getByText / getByPlaceholder call
 * on this page instance will auto-heal on failure.
 */
async function loginAsStandardUser(page) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(STANDARD_USER, PASSWORD);
  return {
    products: new ProductsPage(page),
    cart: new CartPage(page),
    checkout: new CheckoutPage(page),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('SauceDemo — Self-Healing Demo Tests', () => {

  // ── 1. Login ────────────────────────────────────────────────────────────────
  test('Login with valid credentials', async ({ page }) => {
    const { products } = await loginAsStandardUser(page);
    const title = await products.getTitle();
    await expect(title).toHaveText('Products');
  });

  test('Login with invalid credentials shows error', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login('invalid_user', 'wrong_password');
    const error = await login.getErrorMessage();
    await expect(error).toContainText('Username and password do not match');
  });

  // ── 2. Products ─────────────────────────────────────────────────────────────
  test('Add product to cart and verify badge count', async ({ page }) => {
    const { products } = await loginAsStandardUser(page);
    await products.addToCart('Sauce Labs Backpack');
    const badge = await products.getCartBadgeCount();
    await expect(badge).toHaveText('1');
  });

  test('Sort products by price low-to-high', async ({ page }) => {
    const { products } = await loginAsStandardUser(page);
    await products.sortBy('lohi');
    const prices = await products.getProductPrices();
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).toBeGreaterThanOrEqual(prices[i - 1]);
    }
  });

  // ── 3. Cart ─────────────────────────────────────────────────────────────────
  test('Add two items, remove one, verify cart', async ({ page }) => {
    const { products, cart } = await loginAsStandardUser(page);
    await products.addToCart('Sauce Labs Backpack');
    await products.addToCart('Sauce Labs Bike Light');
    await products.goToCart();

    const items = await cart.getCartItems();
    await expect(items).toHaveCount(2);

    await cart.removeItem('Sauce Labs Backpack');
    await expect(items).toHaveCount(1);

    const names = await cart.getItemNames();
    expect(names).toEqual(['Sauce Labs Bike Light']);
  });

  // ── 4. Full checkout ───────────────────────────────────────────────────────
  test('Complete checkout end-to-end', async ({ page }) => {
    const { products, cart, checkout } = await loginAsStandardUser(page);
    await products.addToCart('Sauce Labs Backpack');
    await products.goToCart();
    await cart.checkout();
    await checkout.fillInfo('Jane', 'Doe', '90210');
    await checkout.continue();
    await checkout.finish();
    const header = await checkout.getConfirmationHeader();
    await expect(header).toHaveText('Thank you for your order!');
  });

  // ── 5. Intentionally DRIFTED locator — showcases the healer ────────────
  //    The button text on the site is "Add to cart" but we deliberately use
  //    "Add to Cart" (capital C). The fuzzy matcher / AI healer should
  //    correct this at runtime and the test should still pass.
  test('[HEAL] Drifted button text — "Add to Cart" vs "Add to cart"', async ({ page }) => {
    const { products } = await loginAsStandardUser(page);

    // Intentionally wrong casing — should trigger healing
    const product = page.locator('.inventory_item').filter({ hasText: 'Sauce Labs Onesie' });
    await product.getByRole('button', { name: 'Add to Cart' }).click();

    const badge = await products.getCartBadgeCount();
    await expect(badge).toHaveText('1');
  });

  // ── 6. Intentionally DRIFTED locator — wrong role ──────────────────────
  //    We look for role="link" named "Checkout" but the actual element is
  //    a <button> (role="button"). The AI healer should fix the role mismatch.
  test('[HEAL] Drifted role — link vs button for Checkout', async ({ page }) => {
    const { products, cart } = await loginAsStandardUser(page);
    await products.addToCart('Sauce Labs Bolt T-Shirt');
    await products.goToCart();

    // Intentionally wrong role — should trigger healing
    await page.getByRole('link', { name: 'Checkout' }).click();

    await expect(page.locator('.title')).toHaveText('Checkout: Your Information');
  });

});
