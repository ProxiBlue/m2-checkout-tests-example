import {test, describe, expect } from "@checkout/fixtures";
import * as customerForm from "@checkout/locators/customer_form.locator";


// Flagged skipped 2026-07-22 on the loki branch: Braintree is not the payment provider
// exercised end-to-end on this branch. Loki checkout drives payment through Stripe, and
// the equivalent card-payment flow is covered by src/apps/checkout/tests/checkout_loki_stripe.spec.ts
// (single-source) and checkout_loki_stripe_multisource.spec.ts (multi-source), both using
// the shared `fillStripePayment()` helper on `src/apps/checkout/pages/loki_checkout.page.ts:235`.
//
// Follow-up: `.claude/plans/loki-mageos-3.2.0-merge/option-2-handover.md` documents a planned
// refactor to a new `src/apps/loki/` sub-app that would encode a generic `pay()` abstraction on
// the base checkout page, so tests can call payment without naming a provider. When that
// lands, this spec's coverage moves under `src/apps/loki/tests/checkout_payment.spec.ts`
// and this file can be deleted.
describe.skip("Checkout braintree with one Item in cart", () => {

    test.setTimeout(300000); // 5 minutes — braintree sandbox + admin grid load

    test.beforeEach(async ({simpleProductPage}, testInfo) => {
        await simpleProductPage.navigateTo();
        await simpleProductPage.addToCart();
    });

    test("it can checkout braintree", async ({cartPage, checkoutPage, customerData, adminPage, adminOrdersPage}) => {
        await cartPage.navigateTo();
        const itemLineTotal = await cartPage.getLineItemsPrices();
        //@ts-ignore
        await cartPage.checkSubtotalMatches(itemLineTotal.toFixed(2));
        await cartPage.clickProceedToCheckout();
        await checkoutPage.page.waitForLoadState("domcontentloaded");
        await checkoutPage.page.fill(customerForm.email, customerData.email);
        await checkoutPage.page.waitForLoadState("domcontentloaded");
        await checkoutPage.fillCustomerForm(customerData)
        await checkoutPage.selectShippingMethod();
        const checkoutSubTotal = await checkoutPage.getSubTotal();
        // test totals matches
        expect(itemLineTotal).toEqual(checkoutSubTotal);
        await checkoutPage.selectPaymentmethodByName('Credit Card');

        // Wait for Braintree iframes to be fully loaded (they load asynchronously)
        await checkoutPage.page.waitForTimeout(3000);

        // Wait for all Braintree iframes to be present in DOM
        await checkoutPage.page.waitForSelector('#braintree-hosted-field-number', { state: 'attached', timeout: 15000 });
        await checkoutPage.page.waitForSelector('#braintree-hosted-field-expirationDate', { state: 'attached', timeout: 15000 });
        await checkoutPage.page.waitForSelector('#braintree-hosted-field-cvv', { state: 'attached', timeout: 15000 });

        // Fill credit card number using fill() and Tab to trigger blur/validation
        const creditCardFrame = checkoutPage.page.frameLocator('#braintree-hosted-field-number');
        const ccInput = creditCardFrame.locator('#credit-card-number');
        await ccInput.waitFor({ state: 'visible', timeout: 10000 });
        await ccInput.click();
        await ccInput.fill('4111111111111111');
        await checkoutPage.page.keyboard.press('Tab');
        await checkoutPage.page.waitForTimeout(1000);

        // Fill expiration date
        const expirationFrame = checkoutPage.page.frameLocator('#braintree-hosted-field-expirationDate');
        const expInput = expirationFrame.locator('#expiration');
        await expInput.waitFor({ state: 'visible', timeout: 10000 });
        await expInput.click();
        await expInput.fill('1230');
        await checkoutPage.page.keyboard.press('Tab');
        await checkoutPage.page.waitForTimeout(1000);

        // Fill CVV
        const cvvFrame = checkoutPage.page.frameLocator('#braintree-hosted-field-cvv');
        const cvvInput = cvvFrame.locator('#cvv');
        await cvvInput.waitFor({ state: 'visible', timeout: 10000 });
        await cvvInput.click();
        await cvvInput.fill('123');
        await checkoutPage.page.keyboard.press('Tab');
        await checkoutPage.page.waitForTimeout(1000);

        // Wait for Braintree hosted fields to validate all inputs
        await checkoutPage.page.waitForFunction(() => {
            const containers = [
                document.querySelector('#braintree_cc_number'),
                document.querySelector('#braintree_expirationDate'),
                document.querySelector('#braintree_cc_cid'),
            ];
            return containers.every(c => c && c.classList.contains('braintree-hosted-fields-valid'));
        }, { timeout: 45000 });

        await checkoutPage.actionPlaceOrder();

        // Wait for loading spinner to disappear (use more robust waiting)
        try {
            await checkoutPage.page.locator('img[role="img"][name="Loading..."]').waitFor({ state: 'hidden', timeout: 60000 });
        } catch {
            // Loading spinner may not appear or may have already hidden
        }

        // Wait for navigation to complete
        await checkoutPage.page.waitForLoadState('networkidle');
        await checkoutPage.page.waitForTimeout(3000);

        // Check for error messages first
        const errorMessage = checkoutPage.page.locator('.message-error, .messages .error-msg, .checkout-payment-method .messages');
        const hasError = await errorMessage.count() > 0;
        if (hasError) {
            const errorText = await errorMessage.first().textContent();
        }

        // Verify we're on the success page, not redirected to cart
        const currentUrl = checkoutPage.page.url();
        expect(currentUrl, `Expected success page, got: ${currentUrl}. Payment may have failed - check Braintree sandbox configuration.`).toContain('/checkout/onepage/success');

        let orderId = await checkoutPage.testSuccessPage();
        await adminPage.navigateTo();
        await adminPage.login();
        await adminOrdersPage.navigateTo();
        await adminOrdersPage.checkIfOrderExistsByIncrementId(orderId);
    });


});
