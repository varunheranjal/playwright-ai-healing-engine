class CartPage {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;
  }

  async getCartItems() {
    return this.page.locator('.cart_item');
  }

  async getItemNames() {
    return this.page.locator('.inventory_item_name').allTextContents();
  }

  async removeItem(productName) {
    const item = this.page.locator('.cart_item').filter({ hasText: productName });
    await item.getByRole('button', { name: 'Remove' }).click();
  }

  async continueShopping() {
    await this.page.getByRole('button', { name: 'Continue Shopping' }).click();
  }

  async checkout() {
    await this.page.getByRole('button', { name: 'Checkout' }).click();
  }
}

module.exports = CartPage;
