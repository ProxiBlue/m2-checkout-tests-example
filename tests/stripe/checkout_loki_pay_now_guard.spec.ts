import { test, describe, expect } from "../../fixtures";
import { loadJsonData } from "@utils/functions/file";

/**
 * Loki Checkout — Pay Now guard + loader-overlay + #393 silent-error toast.
 *
 * Covers task 003 of the 419-pay-now-overlay-guard plan — the real-browser
 * (Playwright) verification layer for behaviour landed by:
 *   - Task 001: `LokiCheckoutStepForwardButton` override
 *     (app/design/frontend/Uptactics/pps/LokiCheckout_Core/templates/script/
 *     component/step-forward-button-component.phtml +
 *     app/code/Uptactics/PpsTheme/view/frontend/web/js/loki-step-forward-button.js)
 *     — validation-first loading, loading held across the full post() network
 *     cycle, release on success/4xx-5xx/thrown-exception, #393 no-advance
 *     detection, and mirroring `loading` into the morph-immune
 *     `Alpine.store('UptacticsSubmitGuard').isPlacingOrder`.
 *   - Task 002: the loader-overlay + silent-error toast themselves
 *     (app/code/Uptactics/PpsTheme/view/frontend/templates/script/
 *     pay-now-overlay-guard.phtml, pay-now-error-toast.phtml), anchored in
 *     `before.body.end` — a sibling of, not a descendant of, `#loki-checkout`
 *     — so neither Loki's AJAX morph nor the mobile sidebar re-parenting
 *     script can evaporate or duplicate them.
 *
 * Route interception ([loki-checkout.page.ts] mockPayNowAjax* methods) is
 * used to force the AJAX-error and #393 silent-no-advance paths
 * deterministically, and to widen the mid-flight assertion window on the
 * happy path — installed only immediately before the Pay Now click under
 * test, never during the (unmocked, real-backend) checkout-fill steps that
 * precede it.
 *
 * Payment method — every guard requirement here uses `checkmo`
 * (Check/Money order). Investigation finding (see mockPayNowAjaxSilentNoAdvance's
 * doc in loki_checkout.page.ts): only a NON-Stripe final-step submit
 * actually posts to `loki_components/index/html` — the endpoint the mocks
 * intercept. Stripe's own `stripe.confirmPayment()` redirects the whole
 * browser to `loki_checkout/index/finalize` on success, bypassing
 * LokiAjaxQueue entirely, so a route mock on `loki_components/index/html`
 * cannot observe or alter that path — and, more importantly, the browser
 * navigation would close the page mid-assertion, racing the disable/overlay
 * checks the guard is meant to verify. `checkmo` keeps the page open long
 * enough for the mock's delay window to make the mid-flight state genuinely
 * observable.
 *
 * Three cart scenarios per the fleet three-cart rule (memory
 * feedback_three_cart_scenarios.md / graphiti [d863091a]): requirement 7
 * drives the guard's core disable+overlay/release behaviour across
 * single-item, cross-category 2-item, and pipe+union-ball-valve
 * multi-shipping carts — the same product pairing
 * checkout_loki_stripe_multisource.spec.ts and
 * checkout_loki_stripe_guest_savecard.spec.ts use, reusing that suite's
 * three-cart-fixture pattern (dedicated
 * checkoutLokiPayNowGuard.data.json here rather than importing the
 * save-card spec's data file, to keep this spec decoupled from an
 * unrelated feature's fixture).
 *
 * Stripe fixture data: card number 4242424242424242 is Stripe's published
 * universal test-mode card (sandbox-only per graphiti [3c486d1c]) — no
 * `cus_*` / `pm_*` literals appear anywhere in this file.
 */

interface GuardScenarioProduct {
    entity_id: string;
    qty: string;
}

interface GuardData {
    scenarios: {
        single_item: { products: GuardScenarioProduct[] };
        cross_category_two_item: { products: GuardScenarioProduct[] };
        multi_shipping_pipe_plus_union_ball_valve: { products: GuardScenarioProduct[] };
    };
}

const data = loadJsonData<GuardData>('checkoutLokiPayNowGuard.data.json', 'checkout');

/**
 * Add every product in a scenario to the cart via the fast API-based add
 * (mirrors checkout_loki_stripe_guest_savecard.spec.ts's seedCart).
 */
async function seedCart(
    checkoutStripeSaveCardPage: any,
    products: GuardScenarioProduct[],
): Promise<void> {
    for (const product of products) {
        await checkoutStripeSaveCardPage.addProductToCartById(product.entity_id, product.qty);
    }
}

/**
 * Drive the checkout flow up to (and including) a persisted `checkmo`
 * (Check/Money order) payment selection — ready for the Pay Now guard
 * interactions. Uses the multi-source-aware shipping selector for every
 * scenario — it falls back to the plain single-rate path when no
 * multi-source pager is present, so single/2-item scenarios are unaffected.
 */
async function fillCheckoutReadyForPayNowCheckmo(
    checkoutStripeSaveCardPage: any,
    email: string,
    customerData: any,
): Promise<void> {
    await checkoutStripeSaveCardPage.navigateTo();
    await checkoutStripeSaveCardPage.fillEmail(email);
    await checkoutStripeSaveCardPage.fillDeliveryAddress(customerData);
    await checkoutStripeSaveCardPage.selectShippingMethodHandlingMultiSource();
    await checkoutStripeSaveCardPage.selectFreePaymentMethod('checkmo');
}

describe("checkout_loki_pay_now_guard", () => {
    // Loki checkout is on the `loki` branch — not yet merged to live/uat.
    // Unskip when switching to loki branch (see memory: loki_tests_skipped).

    test.beforeEach(async ({ browserName }) => {
        test.skip(browserName !== 'chromium', 'Pay Now guard suite runs chromium-only (test:stripe script) — see graphiti [ea2c2dc3]');
    });

    // -----------------------------------------------------------------------
    // Requirement 1
    // -----------------------------------------------------------------------
    // @story: loki-pay-now-guard-disables-and-overlays-during-processing
    test("it disables Pay Now and shows loader-overlay during payment processing, preventing double-click", async ({
        checkoutStripeSaveCardPage, customerData,
    }, testInfo) => {
        test.setTimeout(180000);

        await seedCart(checkoutStripeSaveCardPage, data.scenarios.single_item.products);
        await fillCheckoutReadyForPayNowCheckmo(checkoutStripeSaveCardPage, customerData.email, customerData);

        // Widen the mid-flight window so the assertions below can observe
        // the overlay/disabled state before the mocked response lands.
        await checkoutStripeSaveCardPage.mockPayNowAjaxSilentNoAdvance(4000);

        await checkoutStripeSaveCardPage.placeOrder();

        expect(
            await checkoutStripeSaveCardPage.isPayNowDisabled(),
            'Pay Now must be disabled immediately after the first click, while the post is in flight',
        ).toBe(true);
        expect(
            await checkoutStripeSaveCardPage.isLoaderOverlayVisible(),
            'loader-overlay must be visible while the post is in flight',
        ).toBe(true);

        // Attempt a second click while still processing — the native
        // `disabled` attribute means Playwright's own actionability check
        // will not land it against a real button, so this must not throw
        // and must not start a second post/morph cycle.
        await checkoutStripeSaveCardPage.getPayNowButton().click({ timeout: 2000, force: true }).catch(() => {});

        // The forced click not throwing proves nothing on its own — a
        // native `disabled` button silently swallows the click, so this is
        // the actual reproduction check for the #419 double-charge race:
        // the second click attempt must not have started a second post
        // cycle against the (by-then-emptied) cart.
        expect(
            checkoutStripeSaveCardPage.getPayNowPostCount(),
            'a forced second Pay Now click while processing must not start a second post cycle ([419] double-charge regression guard)',
        ).toBe(1);

        await checkoutStripeSaveCardPage.waitForPostAjaxCycle();

        expect(
            await checkoutStripeSaveCardPage.isLoaderOverlayVisible(),
            'loader-overlay must hide once the post/morph cycle completes',
        ).toBe(false);

        await checkoutStripeSaveCardPage.unmockPayNowAjax();
    });

    // -----------------------------------------------------------------------
    // Requirement 2
    // -----------------------------------------------------------------------
    // @story: loki-pay-now-guard-releases-on-ajax-error
    test("it releases loading and re-enables Pay Now on AJAX error", async ({
        checkoutStripeSaveCardPage, customerData,
    }, testInfo) => {
        test.setTimeout(180000);

        await seedCart(checkoutStripeSaveCardPage, data.scenarios.single_item.products);
        await fillCheckoutReadyForPayNowCheckmo(checkoutStripeSaveCardPage, customerData.email, customerData);

        await checkoutStripeSaveCardPage.mockPayNowAjaxError(500);

        await checkoutStripeSaveCardPage.placeOrder();
        await checkoutStripeSaveCardPage.waitForPostAjaxCycle();

        expect(
            await checkoutStripeSaveCardPage.isLoaderOverlayVisible(),
            'loader-overlay must be released after a 500 response',
        ).toBe(false);
        expect(
            await checkoutStripeSaveCardPage.isPayNowDisabled(),
            'Pay Now must be re-enabled after a 500 response',
        ).toBe(false);

        await checkoutStripeSaveCardPage.unmockPayNowAjax();
    });

    // -----------------------------------------------------------------------
    // Requirement 3
    // -----------------------------------------------------------------------
    // @story: loki-pay-now-guard-silent-error-toast-393
    test("it releases loading and shows silent-error toast when post has no step advance and no messages", async ({
        checkoutStripeSaveCardPage, customerData,
    }, testInfo) => {
        test.setTimeout(180000);

        await seedCart(checkoutStripeSaveCardPage, data.scenarios.single_item.products);
        await fillCheckoutReadyForPayNowCheckmo(checkoutStripeSaveCardPage, customerData.email, customerData);

        await checkoutStripeSaveCardPage.mockPayNowAjaxSilentNoAdvance();

        await checkoutStripeSaveCardPage.placeOrder();
        await checkoutStripeSaveCardPage.waitForPostAjaxCycle();

        expect(
            await checkoutStripeSaveCardPage.isLoaderOverlayVisible(),
            'loader-overlay must be released after a silent no-advance/no-message response',
        ).toBe(false);
        expect(
            await checkoutStripeSaveCardPage.isPayNowDisabled(),
            'Pay Now must be re-enabled after a silent no-advance/no-message response',
        ).toBe(false);

        const toastText = await checkoutStripeSaveCardPage.getSilentErrorToastText();

        await testInfo.attach('silent-error-toast-text', {
            body: Buffer.from(toastText),
            contentType: 'text/plain',
        });

        expect(toastText, '#393 silent-error toast must render the guard message').toContain(
            'Payment did not complete',
        );

        await checkoutStripeSaveCardPage.unmockPayNowAjax();
    });

    // -----------------------------------------------------------------------
    // Requirement 4
    // -----------------------------------------------------------------------
    // @story: loki-pay-now-guard-survives-morph-mid-flight
    test("it survives Loki AJAX morph without losing loading state or re-enabling Pay Now mid-flight", async ({
        checkoutStripeSaveCardPage, customerData,
    }, testInfo) => {
        test.setTimeout(180000);

        await seedCart(checkoutStripeSaveCardPage, data.scenarios.single_item.products);
        await fillCheckoutReadyForPayNowCheckmo(checkoutStripeSaveCardPage, customerData.email, customerData);

        const overlayAnchorsBefore = await checkoutStripeSaveCardPage.countPayNowOverlayAnchors();
        expect(overlayAnchorsBefore, 'exactly one overlay anchor must exist before the post').toBe(1);

        await checkoutStripeSaveCardPage.mockPayNowAjaxDelayedMorph(3500);

        await checkoutStripeSaveCardPage.placeOrder();

        expect(
            await checkoutStripeSaveCardPage.isLoaderOverlayVisible(),
            'overlay must be visible immediately after the click (before the delayed morph response lands)',
        ).toBe(true);

        // Still inside the 3.5s delay window — the state must not flicker
        // false-then-true (task 001's "loading-across-post" requirement 2).
        await checkoutStripeSaveCardPage.page.waitForTimeout(1500);

        expect(
            await checkoutStripeSaveCardPage.isLoaderOverlayVisible(),
            'overlay must still be visible mid-flight, before the morph response has landed',
        ).toBe(true);
        expect(
            await checkoutStripeSaveCardPage.isPayNowDisabled(),
            'Pay Now must still be disabled mid-flight, before the morph response has landed',
        ).toBe(true);

        await checkoutStripeSaveCardPage.waitForPostAjaxCycle();

        expect(
            await checkoutStripeSaveCardPage.isLoaderOverlayVisible(),
            'overlay must release once the morph cycle completes',
        ).toBe(false);

        const overlayAnchorsAfter = await checkoutStripeSaveCardPage.countPayNowOverlayAnchors();
        expect(
            overlayAnchorsAfter,
            'exactly one overlay anchor must exist after the morph — no double-merge duplication',
        ).toBe(1);

        await checkoutStripeSaveCardPage.unmockPayNowAjax();
    });

    // -----------------------------------------------------------------------
    // Requirement 5
    // -----------------------------------------------------------------------
    // @story: loki-pay-now-guard-blocks-sidebar-clicks
    test("it blocks clicks on sidebar / summary / shipping-edit while Pay Now is processing", async ({
        checkoutStripeSaveCardPage, customerData,
    }, testInfo) => {
        test.setTimeout(180000);

        await seedCart(checkoutStripeSaveCardPage, data.scenarios.single_item.products);
        await fillCheckoutReadyForPayNowCheckmo(checkoutStripeSaveCardPage, customerData.email, customerData);

        await checkoutStripeSaveCardPage.mockPayNowAjaxSilentNoAdvance(3500);

        await checkoutStripeSaveCardPage.placeOrder();

        expect(
            await checkoutStripeSaveCardPage.isLoaderOverlayVisible(),
            'overlay must be visible before attempting the blocked sidebar click',
        ).toBe(true);

        const blocked = await checkoutStripeSaveCardPage.attemptSidebarClickBlocked();

        expect(
            blocked,
            'a normal click on a sidebar/shipping-method element must be blocked while the overlay is visible',
        ).toBe(true);

        await checkoutStripeSaveCardPage.waitForPostAjaxCycle();

        await checkoutStripeSaveCardPage.unmockPayNowAjax();
    });

    // -----------------------------------------------------------------------
    // Requirement 6 (regression guard for [6c8f0439])
    // -----------------------------------------------------------------------
    // @story: loki-pay-now-guard-validates-before-loading
    test("it validates the form BEFORE setting loading=true so invalid fields remain editable", async ({
        checkoutStripeSaveCardPage, customerData,
    }, testInfo) => {
        test.setTimeout(180000);

        await seedCart(checkoutStripeSaveCardPage, data.scenarios.single_item.products);

        await checkoutStripeSaveCardPage.navigateTo();
        await checkoutStripeSaveCardPage.fillEmail(customerData.email);
        await checkoutStripeSaveCardPage.fillDeliveryAddress(customerData);
        await checkoutStripeSaveCardPage.selectShippingMethodHandlingMultiSource();
        // Deliberately do NOT fill Stripe payment — the payment component
        // stays invalid, matching clickPayNow()'s documented "Test A"
        // no-payment-selection scenario.

        await checkoutStripeSaveCardPage.clickPayNow();

        // Let the async submit() validators settle before asserting the
        // negative (loading never engages) — see mockPayNowAjax* doc note
        // on why this is a poll-safe assertion regardless of timing.
        await checkoutStripeSaveCardPage.page.waitForTimeout(2000);

        expect(
            await checkoutStripeSaveCardPage.isLoaderOverlayVisible(),
            'loader-overlay must never appear when validation fails — loading must not engage before validation',
        ).toBe(false);
        expect(
            await checkoutStripeSaveCardPage.isFirstNameFieldEditable(),
            'First Name field must remain editable after a failed-validation Pay Now click ([6c8f0439] regression guard)',
        ).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Requirement 7 (three-cart rule — graphiti [d863091a])
    // -----------------------------------------------------------------------
    // @story: loki-pay-now-guard-three-cart-scenarios
    test("it passes the guard behavior across single-item / 2-item cross-category / pipe+union-ball-valve multi-shipping carts", async ({
        checkoutStripeSaveCardPage, page,
    }, testInfo) => {
        test.setTimeout(600000);

        const scenarios: Array<{ name: string; products: GuardScenarioProduct[] }> = [
            { name: 'single_item', products: data.scenarios.single_item.products },
            { name: 'cross_category_two_item', products: data.scenarios.cross_category_two_item.products },
            {
                name: 'multi_shipping_pipe_plus_union_ball_valve',
                products: data.scenarios.multi_shipping_pipe_plus_union_ball_valve.products,
            },
        ];

        for (const scenario of scenarios) {
            await test.step(`guard behaviour — ${scenario.name}`, async () => {
                const email = `pay-now-guard-${scenario.name}-${Date.now()}@example.com`;

                await seedCart(checkoutStripeSaveCardPage, scenario.products);
                await fillCheckoutReadyForPayNowCheckmo(checkoutStripeSaveCardPage, email, {
                    firstName: 'Test',
                    lastName: 'Guard',
                    street_one_line: '123 Main St',
                    phone: '8067220086',
                });

                await checkoutStripeSaveCardPage.mockPayNowAjaxSilentNoAdvance(3000);

                await checkoutStripeSaveCardPage.placeOrder();

                expect(
                    await checkoutStripeSaveCardPage.isPayNowDisabled(),
                    `[${scenario.name}] Pay Now must disable during processing`,
                ).toBe(true);
                expect(
                    await checkoutStripeSaveCardPage.isLoaderOverlayVisible(),
                    `[${scenario.name}] loader-overlay must show during processing`,
                ).toBe(true);

                await checkoutStripeSaveCardPage.waitForPostAjaxCycle();

                expect(
                    await checkoutStripeSaveCardPage.isLoaderOverlayVisible(),
                    `[${scenario.name}] loader-overlay must release once the cycle completes`,
                ).toBe(false);
                expect(
                    await checkoutStripeSaveCardPage.isPayNowDisabled(),
                    `[${scenario.name}] Pay Now must re-enable once the cycle completes`,
                ).toBe(false);

                await checkoutStripeSaveCardPage.unmockPayNowAjax();

                // Fresh cart for the next scenario in this same session.
                await page.evaluate(async () => {
                    await fetch('/checkout/cart/', { credentials: 'include' });
                });
            });
        }
    });
});
