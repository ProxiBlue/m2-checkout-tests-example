import { test, describe, expect } from "../fixtures";
import * as lokiLocators from "@checkout/locators/loki_checkout.locator";

/**
 * Loki Checkout — Account Creation Checkbox (MageArray_CheckoutSignup)
 *
 * Tests for #374: integrate account creation checkbox into Loki checkout.
 *
 * Acceptance criteria:
 *   1. Checkbox appears below email field in Loki checkout (guest only)
 *   2. Checkbox is checked by default
 *   3. Hidden when customer is logged in
 *   4. Account created on order placement when checked
 *   5. Account NOT created when checkbox is unchecked
 */
describe("Loki Checkout — account creation checkbox", () => {
    // Loki checkout is on the `loki` branch — not yet merged to live/uat.
    // Unskip when switching to loki branch (see memory: loki_tests_skipped).

    test.setTimeout(180000);

    test.beforeEach(async ({ simpleProductPage }) => {
        await simpleProductPage.navigateTo();
        await simpleProductPage.addToCart('30');
    });

    test("checkbox appears below email field for guest checkout", async ({
        lokiCheckoutPage,
    }) => {
        await lokiCheckoutPage.navigateTo();

        const email = lokiCheckoutPage.page.locator(lokiLocators.email_field).first();
        await expect(email).toBeVisible({ timeout: 15000 });

        const checkbox = lokiCheckoutPage.page.locator(lokiLocators.signup_checkbox);
        await expect(checkbox).toBeVisible({ timeout: 10000 });

        // Checkbox positioned after email
        const emailBox = await email.boundingBox();
        const checkboxBox = await checkbox.boundingBox();
        expect(emailBox).toBeTruthy();
        expect(checkboxBox).toBeTruthy();
        expect(checkboxBox!.y).toBeGreaterThan(emailBox!.y);
    });

    test("checkbox is checked by default", async ({ lokiCheckoutPage }) => {
        await lokiCheckoutPage.navigateTo();

        const checkbox = lokiCheckoutPage.page.locator(lokiLocators.signup_checkbox);
        await expect(checkbox).toBeVisible({ timeout: 15000 });
        await expect(checkbox).toBeChecked();
    });

    test("checkbox is hidden when customer is logged in", async ({
        lokiCheckoutPage,
        customerPage,
        customerData,
    }) => {
        // Verify checkbox exists for guest first
        await lokiCheckoutPage.navigateTo();
        const guestCheckbox = lokiCheckoutPage.page.locator(lokiLocators.signup_checkbox);
        await expect(guestCheckbox).toBeVisible({ timeout: 10000 });

        // Create account and log in
        await customerPage.createAccount(customerData);

        // Checkout as logged-in customer
        await lokiCheckoutPage.navigateTo();
        const checkbox = lokiCheckoutPage.page.locator(lokiLocators.signup_checkbox);
        await expect(checkbox).not.toBeVisible({ timeout: 10000 });
    });

    test("account is created after order placement when checked", async ({
        lokiCheckoutPage,
        customerData,
    }) => {
        const testEmail = `loki-signup-${Date.now()}@example.com`;

        // Verify no account exists
        const preCheck = await lokiCheckoutPage.checkEmailAvailable(testEmail);
        expect(preCheck).toBe(true);

        await lokiCheckoutPage.navigateTo();
        await lokiCheckoutPage.fillEmail(testEmail);

        // Verify signup checkbox is checked
        expect(await lokiCheckoutPage.isSignupCheckboxChecked()).toBe(true);

        await lokiCheckoutPage.fillDeliveryAddress(customerData);
        await lokiCheckoutPage.selectShippingMethod();
        await lokiCheckoutPage.fillStripePayment();
        await lokiCheckoutPage.placeOrder();
        await lokiCheckoutPage.waitForSuccessPage();

        // Verify account was created
        const postCheck = await lokiCheckoutPage.checkEmailAvailable(testEmail);
        expect(postCheck).toBe(false); // false = email taken = account created
    });

    test("account is NOT created when checkbox is unchecked", async ({
        lokiCheckoutPage,
        customerData,
    }) => {
        const testEmail = `loki-nosignup-${Date.now()}@example.com`;

        await lokiCheckoutPage.navigateTo();
        await lokiCheckoutPage.fillEmail(testEmail);
        await lokiCheckoutPage.uncheckSignupCheckbox();

        await lokiCheckoutPage.fillDeliveryAddress(customerData);
        await lokiCheckoutPage.selectShippingMethod();
        await lokiCheckoutPage.fillStripePayment();
        await lokiCheckoutPage.placeOrder();
        await lokiCheckoutPage.waitForSuccessPage();

        // Verify account was NOT created
        const postCheck = await lokiCheckoutPage.checkEmailAvailable(testEmail);
        expect(postCheck).toBe(true); // true = email available = no account
    });
});
