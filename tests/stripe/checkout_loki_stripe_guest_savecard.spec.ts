import { test, describe, expect } from "../../fixtures";
import { loadJsonData } from "@utils/functions/file";
import { execSync } from "child_process";

/**
 * Loki Checkout + Stripe Payment Element — guest save-card opt-in/opt-out.
 *
 * Covers task 010 of the stripe-guest-savedcards-vt plan (retry 4 — Customer
 * Session pivot). Stripe Payment Element only renders its native "Save card
 * for future purchases" checkbox when a Stripe Customer Session is attached to
 * `stripe.elements({customerSessionClientSecret, ...})`
 * (`GuestCustomerSessionProvider` mints the session server-side;
 * `EnableSavePaymentMethodPlugin` injects the secret client-side; the
 * `loki-checkout/magento2-stripe` elementParams composer patch spreads it into
 * the actual `stripe.elements()` call). The checkbox renders default-CHECKED —
 * the guest opts OUT by unchecking it, not in by checking it. A guest places an
 * order with the toggle left checked (or ticked back on after an explicit
 * uncheck), and a row lands in `uptactics_guest_stripe_customers` (task 005's
 * `PersistGuestVaultRow` observer) keyed to the guest's Stripe customer +
 * payment method. Unchecking the toggle before placing the order must result
 * in NO guest-vault row.
 *
 * #351 routing decision (superseding the earlier "never creates a Magento
 * account" invariant — graphiti [550669d0]): `MageArray\CheckoutSignup`'s own
 * "create an account" checkbox (default-CHECKED, independent of the Stripe
 * save-card toggle) converts the guest to a registered Magento customer during
 * the same checkout when left ticked. `PersistGuestVaultRow` now routes the
 * save-card write by that outcome, checked via `$order->getCustomerId()` at
 * observer time:
 *   - Converted (magearray checkbox ticked): write lands in the vendor Stripe
 *     module's own `stripe_customers` table (customer-vault), keyed to the new
 *     `customer_id`. NO row in `uptactics_guest_stripe_customers`.
 *   - Not converted (magearray checkbox unticked): write lands in
 *     `uptactics_guest_stripe_customers` (guest-vault) as before. NO row in
 *     `stripe_customers`, NO `customer_entity` row.
 * Each save-card email lands in exactly one vault — never both, never neither.
 *
 * Three cart scenarios per the fleet three-cart rule (memory
 * feedback_three_cart_scenarios.md / graphiti [d863091a]):
 *   1. Single item (1 ball valve, qty raised to clear the $100 minimum order).
 *   2. Cross-category 2-item (pipe + ball valve, different catalog categories).
 *   3. Multi-shipping: pipe + true-union ball valve — the same product pair
 *      checkout_loki_stripe_multisource.spec.ts uses to trigger PPS Olive Branch
 *      MS vs. GF Easton PA multi-source shipment splitting.
 *
 * Stripe fixture data: card number 4242424242424242 is Stripe's published
 * universal test-mode card. Real-name/real-ID filter: no `cus_*` / `pm_*`
 * literals appear anywhere in this file or its data.json — every Stripe id is
 * created dynamically against the test-mode API during the run and never
 * hard-coded, satisfying graphiti [3c486d1c]. Guest emails come from the
 * `customerData` fixture (faker-generated, unique per run — no real names).
 */

interface SaveCardScenarioProduct {
    entity_id: string;
    qty: string;
}

interface SaveCardData {
    scenarios: {
        single_item: { products: SaveCardScenarioProduct[] };
        cross_category_two_item: { products: SaveCardScenarioProduct[] };
        multi_shipping_pipe_plus_union_ball_valve: { products: SaveCardScenarioProduct[] };
    };
}

const data = loadJsonData<SaveCardData>('checkoutStripeSaveCard.data.json', 'checkout');

/** Direct DB read inside the ddev web container — ground truth for vault rows. */
function dbValue(sql: string): string {
    return execSync(`mysql -sN -e ${JSON.stringify(sql)}`, {
        encoding: 'utf-8',
        timeout: 15000,
    }).trim();
}

function guestVaultRowCount(email: string): number {
    const escaped = email.replace(/'/g, "''");
    const out = dbValue(
        `SELECT COUNT(*) FROM uptactics_guest_stripe_customers WHERE email = '${escaped}'`,
    );
    return parseInt(out, 10) || 0;
}

function magentoCustomerCount(email: string): number {
    const escaped = email.replace(/'/g, "''");
    const out = dbValue(
        `SELECT COUNT(*) FROM customer_entity WHERE email = '${escaped}'`,
    );
    return parseInt(out, 10) || 0;
}

/**
 * Customer-vault row count (#351) — the vendor Stripe module's own
 * `stripe_customers` table, keyed by `customer_email` on the converted
 * customer's row, written by `PersistGuestVaultRow::persistCustomerVaultRow()`.
 */
function stripeCustomerVaultRowCount(email: string): number {
    const escaped = email.replace(/'/g, "''");
    const out = dbValue(
        `SELECT COUNT(*) FROM stripe_customers WHERE customer_email = '${escaped}'`,
    );
    return parseInt(out, 10) || 0;
}

/**
 * Add every product in a scenario to the cart via the fast API-based add
 * (mirrors checkout_loki_stripe_multisource.spec.ts's beforeEach pattern).
 */
async function seedCart(
    checkoutStripeSaveCardPage: any,
    products: SaveCardScenarioProduct[],
): Promise<void> {
    for (const product of products) {
        await checkoutStripeSaveCardPage.addProductToCartById(product.entity_id, product.qty);
    }
}

/**
 * Drive the checkout flow up to (and including) a filled, validated Stripe
 * Payment Element — ready for the save-card toggle interaction and PAY NOW.
 * Uses the multi-source-aware shipping selector for every scenario — it falls
 * back to the plain single-rate path when no multi-source pager is present,
 * so single/2-item scenarios are unaffected.
 *
 * `keepGuest` (#351): the `MageArray\CheckoutSignup` "create an account"
 * checkbox is default-CHECKED and independent of the Stripe save-card
 * toggle — left ticked, it converts the guest to a registered Magento
 * customer during the same checkout, and `PersistGuestVaultRow` then routes
 * the save-card write to the customer-vault (`stripe_customers`) instead of
 * the guest-vault (`uptactics_guest_stripe_customers`). Stories that assert
 * on the guest-vault table must pass `keepGuest: true` to deterministically
 * stay on the guest-vault path, regardless of magearray's own default.
 */
async function fillCheckoutUpToStripePayment(
    checkoutStripeSaveCardPage: any,
    email: string,
    customerData: any,
    keepGuest: boolean = false,
): Promise<void> {
    await checkoutStripeSaveCardPage.navigateTo();
    await checkoutStripeSaveCardPage.fillEmail(email);

    if (keepGuest) {
        await checkoutStripeSaveCardPage.uncheckSignupCheckbox();
    }

    await checkoutStripeSaveCardPage.fillDeliveryAddress(customerData);
    await checkoutStripeSaveCardPage.selectShippingMethodHandlingMultiSource();
    await checkoutStripeSaveCardPage.fillStripePayment();
}

/**
 * Place the order and poll the DB for the resulting guest-vault row count
 * for the given email — the observer (task 005) runs synchronously inside
 * `sales_order_place_after`, but success-page rendering can lag slightly
 * behind order commit (same class of race documented in
 * tax-exempt-loki-guest-checkout.spec.ts), so poll rather than single-shot read.
 */
async function placeOrderAndPollVaultRowCount(
    checkoutStripeSaveCardPage: any,
    email: string,
): Promise<number> {
    await checkoutStripeSaveCardPage.placeOrderAndNavigateToSuccess();

    return pollCount(() => guestVaultRowCount(email), `guest-vault row count for ${email}`);
}

/**
 * #351: places the order, then polls an arbitrary row-count getter — reused
 * for both vault destinations (guest-vault via `guestVaultRowCount`,
 * customer-vault via `stripeCustomerVaultRowCount`) so the routing tests don't
 * duplicate the poll/settle-race handling documented on
 * `placeOrderAndPollVaultRowCount`.
 */
async function placeOrderAndPollCount(
    checkoutStripeSaveCardPage: any,
    countFn: () => number,
    pollMessage: string,
): Promise<number> {
    await checkoutStripeSaveCardPage.placeOrderAndNavigateToSuccess();

    return pollCount(countFn, pollMessage);
}

/**
 * Poll UP TO the timeout for a row to appear — if it never appears the poll
 * simply times out (throws) and the returned count reflects the last read
 * (0), which the caller's own expect() then reports clearly. Handles the same
 * class of race documented in tax-exempt-loki-guest-checkout.spec.ts: the
 * observer runs synchronously inside `sales_order_place_after`, but
 * success-page rendering can lag slightly behind order commit.
 */
async function pollCount(countFn: () => number, message: string): Promise<number> {
    let count = 0;
    try {
        await expect
            .poll(
                async () => {
                    count = countFn();
                    return count;
                },
                {
                    message,
                    timeout: 30000,
                    intervals: [2000, 3000, 5000],
                },
            )
            .toBeGreaterThan(0);
    } catch {
        // Swallow — the caller asserts on `count` with a descriptive message.
    }
    return count;
}

describe("checkout_loki_stripe_guest_savecard", () => {
    // Loki checkout is on the `loki` branch — not yet merged to live/uat.
    // Unskip when switching to loki branch (see memory: loki_tests_skipped).

    test.beforeEach(async ({ browserName }) => {
        test.skip(browserName !== 'chromium', 'Stripe guest save-card suite runs chromium-only (test:stripe script) — see graphiti [7d38ae76]');
    });

    // -----------------------------------------------------------------------
    // Requirement 1
    // -----------------------------------------------------------------------
    // @story: stripe-guest-savecard-toggle-present-1item
    test("it renders the Stripe Payment Element native save-card toggle on guest checkout for a single-item cart", async ({
        checkoutStripeSaveCardPage, customerData, page,
    }, testInfo) => {
        test.setTimeout(180000);

        await seedCart(checkoutStripeSaveCardPage, data.scenarios.single_item.products);
        await fillCheckoutUpToStripePayment(checkoutStripeSaveCardPage, customerData.email, customerData);

        await testInfo.attach('save-card-toggle-visible', {
            body: await page.screenshot({ fullPage: true }),
            contentType: 'image/png',
        });

        const visible = await checkoutStripeSaveCardPage.isSaveCardToggleVisible();
        expect(visible, 'Stripe Payment Element native save-card toggle must be present').toBe(true);

        // NOTE (evidence, not asserted): the toggle's default checked/unchecked
        // state is driven by Stripe's own server-returned `elements/sessions`
        // flag `elements_enable_save_for_future_payments_pre_check` — confirmed
        // via live network trace to be `false` for this account and not settable
        // via any customer-session or Payment Element create-time parameter
        // (`payment_method_save` only controls whether the checkbox exists, not
        // its default state). Default-checked is therefore not currently
        // achievable through documented Stripe API surface; this suite drives
        // both opt-in and opt-out explicitly rather than relying on default state.
    });

    // -----------------------------------------------------------------------
    // Requirement 2
    // -----------------------------------------------------------------------
    // @story: stripe-guest-savecard-optin-writes-vault-1item
    test("it places a guest order with save-card ticked and writes a guest-vault row for a single-item cart", async ({
        checkoutStripeSaveCardPage, customerData, page,
    }, testInfo) => {
        test.setTimeout(180000);

        await seedCart(checkoutStripeSaveCardPage, data.scenarios.single_item.products);
        // keepGuest: this story asserts on the guest-vault table specifically —
        // unticks magearray's create-account checkbox so the order stays guest
        // (#351 routing, see fillCheckoutUpToStripePayment doc).
        await fillCheckoutUpToStripePayment(checkoutStripeSaveCardPage, customerData.email, customerData, true);
        await checkoutStripeSaveCardPage.tickSaveCardToggle();

        const count = await placeOrderAndPollVaultRowCount(checkoutStripeSaveCardPage, customerData.email);

        await testInfo.attach('guest-vault-row-ticked-single-item', {
            body: Buffer.from(JSON.stringify({ email: customerData.email, rowCount: count })),
            contentType: 'application/json',
        });

        expect(count, `guest-vault row must exist for ${customerData.email}`).toBeGreaterThan(0);
    });

    // -----------------------------------------------------------------------
    // Requirement 3
    // -----------------------------------------------------------------------
    // @story: stripe-guest-savecard-optout-no-vault
    test("it places a guest order with save-card unticked and does not write a guest-vault row", async ({
        checkoutStripeSaveCardPage, customerData,
    }, testInfo) => {
        test.setTimeout(180000);

        await seedCart(checkoutStripeSaveCardPage, data.scenarios.single_item.products);
        await fillCheckoutUpToStripePayment(checkoutStripeSaveCardPage, customerData.email, customerData);
        // Explicit opt-OUT: unchecks the toggle regardless of its (currently
        // Stripe-controlled) default state — `untickSaveCardToggle()` is a no-op
        // if already unchecked, forward-compatible if Stripe's default-check
        // rollout flag ever flips for this account.
        await checkoutStripeSaveCardPage.untickSaveCardToggle();

        await checkoutStripeSaveCardPage.placeOrderAndNavigateToSuccess();

        // Give the (synchronous, but success-page-lagging) observer a settle
        // window equal to the polling window used for the positive case, then
        // assert the row was never written.
        await new Promise((resolve) => setTimeout(resolve, 8000));

        const count = guestVaultRowCount(customerData.email);

        await testInfo.attach('guest-vault-row-unticked', {
            body: Buffer.from(JSON.stringify({ email: customerData.email, rowCount: count })),
            contentType: 'application/json',
        });

        expect(count, `no guest-vault row must exist for ${customerData.email} when save-card was unticked`).toBe(0);
    });

    // -----------------------------------------------------------------------
    // Requirement 4
    // -----------------------------------------------------------------------
    // @story: stripe-guest-savecard-optin-writes-vault-2item
    test("it places a guest order with save-card ticked for a 2-item cross-category cart and writes a guest-vault row", async ({
        checkoutStripeSaveCardPage, customerData,
    }, testInfo) => {
        test.setTimeout(180000);

        await seedCart(checkoutStripeSaveCardPage, data.scenarios.cross_category_two_item.products);
        // keepGuest: see Requirement 2 — stays guest so the write lands in the
        // guest-vault table under test (#351 routing).
        await fillCheckoutUpToStripePayment(checkoutStripeSaveCardPage, customerData.email, customerData, true);
        await checkoutStripeSaveCardPage.tickSaveCardToggle();

        const count = await placeOrderAndPollVaultRowCount(checkoutStripeSaveCardPage, customerData.email);

        await testInfo.attach('guest-vault-row-cross-category', {
            body: Buffer.from(JSON.stringify({ email: customerData.email, rowCount: count })),
            contentType: 'application/json',
        });

        expect(count, `guest-vault row must exist for ${customerData.email}`).toBeGreaterThan(0);
    });

    // -----------------------------------------------------------------------
    // Requirement 5
    // -----------------------------------------------------------------------
    // @story: stripe-guest-savecard-optin-multishipping-vault
    test("it places a guest order with save-card ticked for a pipe plus union-ball-valve multi-shipping cart and writes a guest-vault row", async ({
        checkoutStripeSaveCardPage, customerData,
    }, testInfo) => {
        test.setTimeout(300000);

        await seedCart(
            checkoutStripeSaveCardPage,
            data.scenarios.multi_shipping_pipe_plus_union_ball_valve.products,
        );
        // keepGuest: see Requirement 2 — stays guest so the write lands in the
        // guest-vault table under test (#351 routing).
        await fillCheckoutUpToStripePayment(checkoutStripeSaveCardPage, customerData.email, customerData, true);
        await checkoutStripeSaveCardPage.tickSaveCardToggle();

        const count = await placeOrderAndPollVaultRowCount(checkoutStripeSaveCardPage, customerData.email);

        await testInfo.attach('guest-vault-row-multi-shipping', {
            body: Buffer.from(JSON.stringify({ email: customerData.email, rowCount: count })),
            contentType: 'application/json',
        });

        expect(count, `guest-vault row must exist for ${customerData.email}`).toBeGreaterThan(0);
    });

    // -----------------------------------------------------------------------
    // Requirement 6 (#351 — supersedes the old "no Magento account created"
    // story, graphiti [550669d0]/[92cd0553]). `MageArray\CheckoutSignup`'s own
    // "create an account" checkbox is default-CHECKED and independent of the
    // Stripe save-card toggle. Left ticked, it converts the guest to a
    // registered Magento customer during the same checkout
    // (`checkout_submit_all_after`) — `PersistGuestVaultRow` detects this via
    // `$order->getCustomerId()` and routes the save-card write to the vendor
    // Stripe module's own `stripe_customers` table (customer-vault) instead
    // of `uptactics_guest_stripe_customers` (guest-vault).
    // -----------------------------------------------------------------------
    // @story: stripe-guest-savecard-routes-to-customer-vault-when-converted
    test("it routes save-card to stripe_customers (customer-vault) when magearray converts the guest to a Magento customer", async ({
        checkoutStripeSaveCardPage, customerData,
    }, testInfo) => {
        test.setTimeout(180000);

        await seedCart(checkoutStripeSaveCardPage, data.scenarios.single_item.products);
        await fillCheckoutUpToStripePayment(checkoutStripeSaveCardPage, customerData.email, customerData);
        // magearray "create account" checkbox left at its site-wide default
        // (ticked) — the guest converts to a Magento customer.
        expect(
            await checkoutStripeSaveCardPage.isSignupCheckboxChecked(),
            'magearray create-account checkbox must default to checked for this scenario',
        ).toBe(true);
        await checkoutStripeSaveCardPage.tickSaveCardToggle();

        const customerVaultCount = await placeOrderAndPollCount(
            checkoutStripeSaveCardPage,
            () => stripeCustomerVaultRowCount(customerData.email),
            `customer-vault (stripe_customers) row count for ${customerData.email}`,
        );
        const guestVaultCount = guestVaultRowCount(customerData.email);
        const customerCount = magentoCustomerCount(customerData.email);

        await testInfo.attach('routes-to-customer-vault-when-converted', {
            body: Buffer.from(JSON.stringify({
                email: customerData.email,
                customerVaultCount,
                guestVaultCount,
                customerCount,
            })),
            contentType: 'application/json',
        });

        expect(customerCount, `Magento customer account must exist for ${customerData.email}`).toBeGreaterThan(0);
        expect(
            customerVaultCount,
            `stripe_customers (customer-vault) row must exist for ${customerData.email}`,
        ).toBeGreaterThan(0);
        expect(
            guestVaultCount,
            `no uptactics_guest_stripe_customers (guest-vault) row must exist for ${customerData.email}`,
        ).toBe(0);
    });

    // -----------------------------------------------------------------------
    // Requirement 7 (#351)
    // -----------------------------------------------------------------------
    // @story: stripe-guest-savecard-routes-to-guest-vault-when-not-converted
    test("it routes save-card to uptactics_guest_stripe_customers (guest-vault) when magearray does NOT convert the guest", async ({
        checkoutStripeSaveCardPage, customerData,
    }, testInfo) => {
        test.setTimeout(180000);

        await seedCart(checkoutStripeSaveCardPage, data.scenarios.single_item.products);
        // keepGuest: guest actively opts OUT of account creation — magearray
        // must NOT convert this order to a registered customer (#351 routing).
        await fillCheckoutUpToStripePayment(checkoutStripeSaveCardPage, customerData.email, customerData, true);
        await checkoutStripeSaveCardPage.tickSaveCardToggle();

        const guestVaultCount = await placeOrderAndPollCount(
            checkoutStripeSaveCardPage,
            () => guestVaultRowCount(customerData.email),
            `guest-vault (uptactics_guest_stripe_customers) row count for ${customerData.email}`,
        );
        const customerVaultCount = stripeCustomerVaultRowCount(customerData.email);
        const customerCount = magentoCustomerCount(customerData.email);

        await testInfo.attach('routes-to-guest-vault-when-not-converted', {
            body: Buffer.from(JSON.stringify({
                email: customerData.email,
                guestVaultCount,
                customerVaultCount,
                customerCount,
            })),
            contentType: 'application/json',
        });

        expect(customerCount, `no Magento customer account must exist for ${customerData.email}`).toBe(0);
        expect(
            guestVaultCount,
            `uptactics_guest_stripe_customers (guest-vault) row must exist for ${customerData.email}`,
        ).toBeGreaterThan(0);
        expect(
            customerVaultCount,
            `no stripe_customers (customer-vault) row must exist for ${customerData.email}`,
        ).toBe(0);
    });
});
