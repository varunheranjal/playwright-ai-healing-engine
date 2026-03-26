const LocatorHealer = require('../shared/utils/locatorHealer');

class LoginPage {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;
    this.healer = LocatorHealer.wrapPage(page, {
      projectRoot: require('path').resolve(__dirname, '..'),
    });
  }

  async goto() {
    await this.page.goto('/');
  }

  async login(username, password) {
    await this.page.getByPlaceholder('Username').fill(username);
    await this.page.getByPlaceholder('Password').fill(password);
    await this.page.getByRole('button', { name: 'Login' }).click();
  }

  async getErrorMessage() {
    return this.page.locator('[data-test="error"]');
  }
}

module.exports = LoginPage;
