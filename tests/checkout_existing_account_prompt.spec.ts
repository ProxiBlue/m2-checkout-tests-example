import { test, describe, expect } from "../fixtures";
import * as lokiLocators from "@checkout/locators/loki_checkout.locator";

describe("Checkout - detects existing account for logon", () => {

    // Fixture chain is heavy: customer create + logout + product add-to-cart +
    // /checkout/ load (Loki bootstrap is slow) + email fill + Loki AJAX login-form
    // swap. 50s was too tight on this branch — the test reached the login-form
    // step successfully (password field visible in error-context snapshot) but
    // hit the timeout before the final assertion. 90s absorbs env variability.
    test.setTimeout(90000);

    test("Check existing email triggers logon prompt", async ({ checkoutPage, page, customerPage, customerData, simpleProductPage  }) => {
        await customerPage.createAccount(customerData);
        await customerPage.logout();
        await simpleProductPage.navigateTo();
        await simpleProductPage.addToCart();
        await checkoutPage.navigateTo();

        // Loki does the existing-email check server-side (SwitchEmailTemplatePlugin →
        // AccountManagementInterface::isEmailAvailable) during its internal
        // loki-components AJAX re-render — there is NO /rest/V1/customers/isEmailAvailable
        // browser-side XHR to wait for. Instead we assert on the DOM outcome:
        // when the email is recognised as belonging to an existing account, Loki
        // swaps in the login form (LokiCheckout_AdvancedEmailField::login.phtml)
        // which contains a type=password input.
        // Requires: checkout/options/enable_guest_checkout_login = 1 (default in this project).
        const emailField = page.getByRole('textbox', { name: 'Email' });
        await emailField.waitFor({ state: 'visible' });
        await emailField.fill(customerData.email);

        // Press Tab: fires native `blur` + `change`, which Loki's Alpine `@change="submit"`
        // binds to. Plain `blur()` doesn't always emit `change` reliably in Playwright.
        // The submit triggers a POST to /loki_components/repository/dispatch that
        // re-renders the email block with the login form (SwitchEmailTemplatePlugin).
        await emailField.press('Tab');

        // Wait for the Loki AJAX round-trip that swaps in the login form. Response
        // URL contains /loki_components/ — matching that is more stable than polling
        // the DOM for the password input.
        await page.waitForResponse(
            (r) => r.url().includes('/loki_components/') && r.request().method() === 'POST',
            { timeout: 30000 },
        );

        // Password field surfaces once the swap completes. Use `expect().toBeVisible`
        // rather than raw waitForSelector for better retry semantics on Alpine-hydrated DOM.
        await expect(page.locator(lokiLocators.login_password_field)).toBeVisible({ timeout: 30000 });

    });

});
