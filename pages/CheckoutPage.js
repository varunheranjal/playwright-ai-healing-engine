class CheckoutPage {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;
  }

  async fillInfo(firstName, lastName, postalCode) {
    await this.page.getByPlaceholder('First Name').fill(firstName);
    await this.page.getByPlaceholder('Last Name').fill(lastName);
    await this.page.getByPlaceholder('Zip/Postal Code').fill(postalCode);
  }

  async continue() {
    await this.page.getByRole('button', { name: 'Continue' }).click();
  }

  async finish() {
    await this.page.getByRole('button', { name: 'Finish' }).click();
  }

  async getConfirmationHeader() {
    return this.page.locator('.complete-header');
  }

  async getTotalPrice() {
    const text = await this.page.locator('.summary_total_label').textContent();
    return parseFloat(text.replace('Total: $', ''));
  }

  async backToProducts() {
    await this.page.getByRole('button', { name: 'Back Home' }).click();
  }
}

module.exports = CheckoutPage;
