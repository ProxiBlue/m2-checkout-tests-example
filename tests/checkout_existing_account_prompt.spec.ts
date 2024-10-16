import { test, describe, expect } from "../fixtures";
import * as locators from "../locators/checkout.locator";

describe("Checkout - detects existing account for logon", () => {

    test.setTimeout(50000);

    test("Check existing email triggers logon prompt", async ({ checkoutPage, page, customerPage, customerData, simpleProductPage  }) => {
        await customerPage.createAccount(customerData);
        await customerPage.logout();
        await simpleProductPage.navigateTo();
        await simpleProductPage.addToCart();
        await checkoutPage.navigateTo();
        await page.waitForSelector(locators.email_field);
        await page.locator(locators.email_field).isVisible();
        await page.locator(locators.email_field).fill(customerData.email);
        const response = await page.waitForResponse(response => response.url().includes('/rest/default/V1/customers/isEmailAvailable'));
        expect(response.status()).toBe(200);
        const responseBody =  await response.text();
        expect(responseBody).toContain('false');
        await page.waitForSelector(locators.password_field);
        expect(page.locator(locators.password_field)).toBeVisible();

    });

});
