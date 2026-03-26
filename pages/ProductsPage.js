class ProductsPage {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;
  }

  async getTitle() {
    return this.page.locator('.title');
  }

  async addToCart(productName) {
    const product = this.page.locator('.inventory_item').filter({ hasText: productName });
    await product.getByRole('button', { name: 'Add to cart' }).click();
  }

  async removeFromCart(productName) {
    const product = this.page.locator('.inventory_item').filter({ hasText: productName });
    await product.getByRole('button', { name: 'Remove' }).click();
  }

  async openProduct(productName) {
    await this.page.getByText(productName, { exact: true }).click();
  }

  async getCartBadgeCount() {
    return this.page.locator('.shopping_cart_badge');
  }

  async goToCart() {
    await this.page.locator('.shopping_cart_link').click();
  }

  async sortBy(option) {
    await this.page.locator('.product_sort_container').selectOption(option);
  }

  async getProductNames() {
    return this.page.locator('.inventory_item_name').allTextContents();
  }

  async getProductPrices() {
    const texts = await this.page.locator('.inventory_item_price').allTextContents();
    return texts.map(t => parseFloat(t.replace('$', '')));
  }
}

module.exports = ProductsPage;
