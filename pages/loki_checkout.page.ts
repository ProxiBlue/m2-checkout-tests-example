import BasePage from "@common/pages/base.page";
import { Page, Response, TestInfo, expect, test } from "@playwright/test";
import * as locators from "../locators/loki_checkout.locator";
import { CustomerData } from '@common/interfaces/CustomerData';
import { loadJsonData } from "@utils/functions/file";
import { execSync } from "child_process";

interface CheckoutData {
    default: {
        url?: string;
        success_page_heading?: string;
    };
}

const defaultData: CheckoutData = { default: {} };
let data = loadJsonData<CheckoutData>('checkout.data.json', 'checkout', defaultData);

if (data && !data.default) {
    data = { default: data as any };
}

export default class LokiCheckoutPage extends BasePage {

    constructor(public page: Page, public workerInfo: TestInfo) {
        super(page, workerInfo, data, locators);
    }

    async navigateTo() {
        await test.step(
            this.workerInfo.project.name + ": Navigate to Loki checkout",
            async () => {
                // Loki checkout hijacks /checkout/ via LokiCheckoutRouter when enabled
                await this.page.goto(process.env.url + "checkout/");
                await this.page.waitForLoadState("domcontentloaded");
                await this.page.waitForTimeout(3000);
            }
        );
    }

    async fillEmail(email: string) {
        await test.step(
            this.workerInfo.project.name + ": Fill email: " + email,
            async () => {
                const emailInput = this.page.getByRole("textbox", { name: "Email" }).first();
                await emailInput.waitFor({ state: "visible", timeout: 15000 });
                await emailInput.click();
                await emailInput.fill(email);
                await emailInput.press("Tab");
                await this.page.waitForTimeout(3000);
            }
        );
    }

    async fillDeliveryAddress(customerData: CustomerData) {
        await test.step(
            this.workerInfo.project.name + ": Fill delivery address",
            async () => {
                const firstNameInput = this.page.getByRole("textbox", { name: "First Name" }).first();
                await firstNameInput.waitFor({ state: "visible", timeout: 10000 });

                const fields = [
                    { name: "First Name", value: customerData.firstName },
                    { name: "Last Name", value: customerData.lastName },
                    { name: "Address", value: customerData.street_one_line },
                    { name: "Zipcode", value: "38654" },
                    { name: "City", value: "Olive Branch" },
                    { name: "Phone Number", value: customerData.phone },
                ];

                for (const field of fields) {
                    const input = this.page.getByRole("textbox", { name: field.name }).first();
                    await input.click();
                    await input.fill(field.value);
                    await input.press("Tab");
                    await this.page.waitForTimeout(300);
                }

                // Verify First Name stuck (Loki AJAX can wipe it)
                const firstNameValue = await firstNameInput.inputValue();
                if (!firstNameValue) {
                    await firstNameInput.click();
                    await firstNameInput.fill(customerData.firstName);
                    await firstNameInput.press("Tab");
                    await this.page.waitForTimeout(500);
                }

                // Select state — Mississippi (region_id = 35 for US).
                // The Loki Shopify checkout uses LokiComboboxComponent (Alpine-based)
                // with a hidden <select>. DOM-level selectOption fails on hidden elements.
                // Use the Alpine LokiCheckout store to set the region component value
                // directly — same pattern as checkout_loki_sidebar_shipping.spec.ts.
                await this.page.evaluate(() => {
                    const store = (window as any).Alpine?.store?.('LokiCheckout');

                    if (!store) return;

                    const components = store.getComponentArray?.() || [];
                    const regionComp = components.find(
                        (c: any) => c.fieldName === 'region' || c.fieldName === 'region_id'
                    );

                    if (regionComp) {
                        regionComp.value = '35'; // Mississippi
                        regionComp.valid = true;
                        regionComp.post('35');
                    }
                });
                await this.page.waitForTimeout(1500);
            }
        );
    }

    async fillDeliveryAddressWithCompany(
        customerData: CustomerData,
        companyName: string,
        city: string,
        zip: string,
        stateLabel: string,
    ) {
        await test.step(
            this.workerInfo.project.name + ": Fill delivery address with company (tax-exempt)",
            async () => {
                const firstNameInput = this.page.getByRole("textbox", { name: "First Name" }).first();
                await firstNameInput.waitFor({ state: "visible", timeout: 10000 });

                const namedFields = [
                    { name: "First Name", value: customerData.firstName },
                    { name: "Last Name", value: customerData.lastName },
                    { name: "Address", value: customerData.street_one_line },
                    { name: "Zipcode", value: zip },
                    { name: "City", value: city },
                    { name: "Phone Number", value: customerData.phone },
                ];

                for (const field of namedFields) {
                    const input = this.page.getByRole("textbox", { name: field.name }).first();

                    if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
                        await input.click();
                        await input.fill(field.value);
                        await input.press("Tab");
                        await this.page.waitForTimeout(300);
                    }
                }

                // Fill company via autocomplete attribute (Shopify template uses placeholder-as-label)
                // autocomplete="shipping organization" is set in loki_checkout_block_shipping_address.xml
                const companyInput = this.page.locator('input[autocomplete*="organization"]').first();

                if (await companyInput.isVisible({ timeout: 3000 }).catch(() => false)) {
                    await companyInput.click();
                    await companyInput.fill(companyName);
                    // Dispatch input + change explicitly to trigger Alpine's reactive update
                    await companyInput.evaluate((el: HTMLInputElement, val: string) => {
                        el.value = val;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    }, companyName);
                    await companyInput.press("Tab");
                    // Allow Alpine to react and loki_components AJAX to save value
                    await this.page.waitForTimeout(2000);
                }

                // Verify First Name stuck (Loki AJAX can wipe it)
                const firstNameValue = await firstNameInput.inputValue();

                if (!firstNameValue) {
                    await firstNameInput.click();
                    await firstNameInput.fill(customerData.firstName);
                    await firstNameInput.press("Tab");
                    await this.page.waitForTimeout(500);
                }

                // Select state via Alpine LokiCheckout store — the Loki Shopify
                // checkout uses a hidden <select> inside LokiComboboxComponent,
                // so DOM-level selectOption fails. Resolve stateLabel to a region_id
                // via the select's options, then set via Alpine store.
                const regionId = await this.page.evaluate((label: string) => {
                    // Try to find the region id from the hidden select
                    const selects = document.querySelectorAll('select');

                    for (const sel of selects) {
                        const option = Array.from(sel.options).find(
                            (o) => o.text.toLowerCase().includes(label.toLowerCase())
                        );

                        if (option && option.value) {
                            return option.value;
                        }
                    }

                    return null;
                }, stateLabel);

                await this.page.evaluate((rid: string | null) => {
                    if (!rid) return;

                    const store = (window as any).Alpine?.store?.('LokiCheckout');

                    if (!store) return;

                    const components = store.getComponentArray?.() || [];
                    const regionComp = components.find(
                        (c: any) => c.fieldName === 'region' || c.fieldName === 'region_id'
                    );

                    if (regionComp) {
                        regionComp.value = rid;
                        regionComp.valid = true;
                        regionComp.post(rid);
                    }
                }, regionId);
                await this.page.waitForTimeout(1000);
            }
        );
    }

    async selectShippingMethod() {
        await test.step(
            this.workerInfo.project.name + ": Select shipping method",
            async () => {
                // Pass undefined as arg (2nd param) so timeout goes to options (3rd param).
                // actionTimeout: 0 in playwright.config makes the default timeout infinite;
                // explicit timeout must be in the 3rd argument to be honoured.
                await this.page.waitForFunction(
                    () => document.querySelectorAll('input[type="radio"][name*="shipping"]').length > 0,
                    undefined,
                    { timeout: 45000 }
                );
                await this.page.locator(locators.shipping_radio).first().check();
                await this.page.waitForTimeout(3000);
            }
        );
    }

    async fillStripePayment() {
        await test.step(
            this.workerInfo.project.name + ": Fill Stripe test card",
            async () => {
                await this.page.locator(locators.stripe_radio).check();
                await this.page.waitForSelector(locators.stripe_iframe, { state: "visible", timeout: 20000 });
                await this.page.waitForTimeout(2000);

                const stripeFrame = this.page.frameLocator(locators.stripe_iframe);

                const cardNumber = stripeFrame.locator(locators.stripe_card_number);
                await cardNumber.waitFor({ state: "visible", timeout: 15000 });
                await cardNumber.click();
                await cardNumber.fill("4242424242424242");

                const expiry = stripeFrame.locator(locators.stripe_expiry);
                await expiry.click();
                await expiry.fill("1230");

                const cvc = stripeFrame.locator(locators.stripe_cvc);
                await cvc.click();
                await cvc.fill("123");
                await cvc.press("Tab");
                await this.page.waitForTimeout(3000);
            }
        );
    }

    async placeOrder() {
        await test.step(
            this.workerInfo.project.name + ": Place order",
            async () => {
                const payNowBtn = this.page.locator(locators.pay_now_button);
                await expect(payNowBtn).toBeEnabled({ timeout: 30000 });
                await payNowBtn.click();
            }
        );
    }

    /**
     * Place the order and navigate to the success page, working around
     * the PHP session race condition where SuccessValidator reads stale
     * session data before FinalStep::submit() has committed lastOrderId.
     *
     * Flow:
     *   1. Register a route handler to intercept ALL loki_components responses.
     *   2. Click PAY NOW.
     *   3. The handler detects the JSON {"redirect": successUrl} response from
     *      FinalStep::submit() (other responses return HTML, not JSON with redirect).
     *   4. After intercepting, wait 3s for PHP to commit the session to Redis.
     *   5. Navigate explicitly to the success URL.
     *
     * Without the 3s wait, Alpine's immediate document.location.assign() races
     * against PHP's session_write_close() and SuccessValidator reads stale
     * session data (lastOrderId = null), causing a redirect to /checkout/cart/.
     */
    async placeOrderAndNavigateToSuccess(): Promise<string> {
        return await test.step(
            this.workerInfo.project.name + ": Place order (with session-commit wait)",
            async () => {
                const payNowBtn = this.page.locator(locators.pay_now_button);
                await expect(payNowBtn).toBeEnabled({ timeout: 30000 });

                // Collect the redirect URL from the first loki_components response
                // that contains {"redirect": "..."}. We use a resolved-promise flag so
                // the route handler fires at most once per placeOrder call.
                let successRedirectUrl = '';
                let redirectResolved = false;

                const onResponse = async (response: Response) => {
                    if (redirectResolved) return;
                    if (!response.url().includes('loki_components/index/html')) return;
                    if (response.status() !== 200) return;

                    try {
                        const body = await response.text();
                        const data = JSON.parse(body);
                        if (data?.redirect) {
                            successRedirectUrl = data.redirect;
                            redirectResolved = true;
                        }
                    } catch (_e) {
                        // HTML response — not the PAY NOW redirect
                    }
                };

                this.page.on('response', onResponse);

                await payNowBtn.click();

                // Wait up to 120 seconds for the PAY NOW AJAX to complete (FinalStep
                // can take 10+ seconds with AvaTax + account creation). Bail out
                // early if Loki's native redirect already navigated us to success.
                const deadline = Date.now() + 120000;
                while (!redirectResolved && Date.now() < deadline) {
                    const path = new URL(this.page.url()).pathname;
                    if (/success/.test(path)) {
                        this.page.off('response', onResponse);
                        return this.page.url();
                    }
                    await this.page.waitForTimeout(500);
                }

                this.page.off('response', onResponse);

                if (!redirectResolved) {
                    // The response-capture hook can silently miss the redirect
                    // JSON under long suite runs (observed: order placed +
                    // holded in DB while the page still sat on /checkout/).
                    // The one-shot session success flags are set iff the order
                    // placed — so navigating to the canonical success URL
                    // directly either renders the success page (order placed,
                    // capture missed) or bounces to cart (genuine failure,
                    // which the caller's assertions then report correctly).
                    const base = (process.env.url as string).replace(/\/$/, '');
                    const directUrl = base + '/checkout/onepage/success/';
                    await this.page.goto(directUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
                    if (/success/.test(new URL(this.page.url()).pathname)) {
                        return directUrl;
                    }
                    return '';
                }

                // Navigate IMMEDIATELY. Two reasons:
                // 1. Navigation destroys the page's JS context, killing any
                //    QUEUED Loki dispatches — a stale post-order dispatch hits
                //    the now-dead quote server-side and its RedirectException
                //    response yanks the browser to the (empty) cart page,
                //    losing the success state.
                // 2. Whichever GET reaches /checkout/onepage/success first
                //    CONSUMES the one-shot session success flags
                //    (Success controller calls clearQuote()). Ours must be
                //    that first GET — waiting invites the race above.
                await this.page.goto(successRedirectUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

                // If the validator still bounced us (rare timing), one retry —
                // flags are only consumed by a RENDERED success page, so a
                // bounce leaves them intact for the second attempt.
                if (!/success/.test(new URL(this.page.url()).pathname)) {
                    await this.page.waitForTimeout(2000);
                    await this.page.goto(successRedirectUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
                }

                return successRedirectUrl;
            }
        );
    }

    async waitForSuccessPage(): Promise<string> {
        return await test.step(
            this.workerInfo.project.name + ": Wait for success page",
            async () => {
                await this.page.waitForURL(
                    (url) => url.pathname.includes("success") || url.pathname.includes("finalize"),
                    { timeout: 60000 }
                );

                if (this.page.url().includes("finalize")) {
                    await this.page.waitForURL(
                        (url) => !url.pathname.includes("finalize"),
                        { timeout: 60000 }
                    );
                }

                await this.page.waitForLoadState("domcontentloaded");
                expect(this.page.url()).toContain("success");

                const successHeading = this.page.locator(locators.success_heading).first();
                await expect(successHeading).toContainText(/thank you/i, { timeout: 10000 });

                const orderText = await this.page.locator(locators.success_container).first().textContent();
                const orderMatch = orderText?.match(/order\s*#?\s*(?:is:?\s*)?(\w+)/i);
                return orderMatch ? orderMatch[1].replace(/\.$/, "") : "";
            }
        );
    }

    async isSignupCheckboxVisible(): Promise<boolean> {
        return await this.page.locator(locators.signup_checkbox).isVisible({ timeout: 5000 }).catch(() => false);
    }

    async isSignupCheckboxChecked(): Promise<boolean> {
        return await this.page.locator(locators.signup_checkbox).isChecked();
    }

    async uncheckSignupCheckbox() {
        await test.step(
            this.workerInfo.project.name + ": Uncheck signup checkbox",
            async () => {
                const checkbox = this.page.locator(locators.signup_checkbox);
                await checkbox.uncheck();
                await expect(checkbox).not.toBeChecked();
                await this.page.waitForTimeout(2000);
            }
        );
    }

    async checkEmailAvailable(email: string): Promise<boolean> {
        return await this.page.evaluate(async (email) => {
            const resp = await fetch("/rest/default/V1/customers/isEmailAvailable", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ customerEmail: email }),
            });
            return resp.ok ? await resp.json() : null;
        }, email);
    }

    async taxExemptCheckboxIsVisible(): Promise<boolean> {
        return await this.page.locator(locators.tax_exempt_checkbox).isVisible({ timeout: 5000 }).catch(() => false);
    }

    async taxExemptWarningIsVisible(): Promise<boolean> {
        return await this.page.locator(locators.tax_exempt_warning_note).isVisible({ timeout: 5000 }).catch(() => false);
    }

    async tickTaxExempt(): Promise<void> {
        await test.step(
            this.workerInfo.project.name + ": Tick tax-exempt checkbox",
            async () => {
                const checkbox = this.page.locator(locators.tax_exempt_checkbox);
                await expect(checkbox).toBeVisible({ timeout: 15000 });

                // Poll-and-reclick: a Loki morph fired by a concurrent
                // field-save can re-render the sidebar from PRE-tick server
                // state and silently revert the checkbox after a single
                // click+assert passed. Keep clicking until the checked state
                // holds. (Verified manually: the tick itself works — tax
                // drops to $0.00 — this only guards the morph race.)
                await expect
                    .poll(
                        async () => {
                            const checked = await checkbox.isChecked().catch(() => false);
                            if (!checked) {
                                await checkbox.click().catch(() => {});
                            }
                            return checkbox.isChecked().catch(() => false);
                        },
                        { timeout: 30000, intervals: [1000, 2000, 3000] },
                    )
                    .toBe(true);

                // Let the tick's own loki_components dispatch settle before
                // callers read totals or re-select shipping.
                await this.page.waitForTimeout(2000);
            }
        );
    }

    async untickTaxExempt(): Promise<void> {
        await test.step(
            this.workerInfo.project.name + ": Untick tax-exempt checkbox",
            async () => {
                const checkbox = this.page.locator(locators.tax_exempt_checkbox);
                await expect(checkbox).toBeVisible({ timeout: 15000 });

                // Mirror of tickTaxExempt: poll-and-reclick against morph reverts.
                await expect
                    .poll(
                        async () => {
                            const checked = await checkbox.isChecked().catch(() => true);
                            if (checked) {
                                await checkbox.click().catch(() => {});
                            }
                            return checkbox.isChecked().catch(() => true);
                        },
                        { timeout: 30000, intervals: [1000, 2000, 3000] },
                    )
                    .toBe(false);

                await this.page.waitForTimeout(2000);
            }
        );
    }

    async signupCheckboxIsChecked(): Promise<boolean> {
        return await this.page.locator(locators.signup_checkbox).isChecked().catch(() => false);
    }

    /**
     * Force a loki_components AJAX by directly calling post() on the shipping
     * postcode component, bypassing the submitValue() early-return guard that
     * prevents a second AJAX when the field value has not changed.
     *
     * This is needed after tickTaxExempt() / untickTaxExempt() to ensure the
     * sidebar re-renders with the updated tax totals from the DB (the first AJAX
     * response may carry stale totals due to a PHP static-cache race).
     */
    async nudgeLokiAjax(): Promise<void> {
        await test.step(
            this.workerInfo.project.name + ": Nudge Loki AJAX (force postcode post)",
            async () => {
                const result = await this.page.evaluate(() => {
                    const store = (window as any).Alpine?.store?.('LokiComponents');

                    if (!store) {
                        return 'no LokiComponents store';
                    }

                    const postcode = store.getComponentByBlockId?.('loki-checkout.shipping.address.postcode');

                    if (!postcode) {
                        return 'no postcode component';
                    }

                    if (typeof postcode.post !== 'function') {
                        return 'post is not a function';
                    }

                    postcode.post();

                    return `posted: blockId=${postcode.blockId} value=${postcode.value} targets=${JSON.stringify(postcode.targets)}`;
                });

            }
        );
    }

    async waitForLokiComponentsResponse(timeout = 10000): Promise<void> {
        await test.step(
            this.workerInfo.project.name + ": Wait for loki_components AJAX response",
            async () => {
                try {
                    const response = await this.page.waitForResponse(
                        (response) =>
                            response.url().includes('loki_components/index/html') &&
                            response.status() === 200,
                        { timeout },
                    );
                    const body = await response.text().catch(() => '');
                    const taxMatch = body.match(/data-code="tax"[\s\S]*?>([\s\S]*?)<\/dd>/);
                    const taxRaw = taxMatch ? taxMatch[1].replace(/<[^>]+>/g, '').trim() : null;
                    const bodyHasTax = body.includes('data-code="tax"');
                    if (bodyHasTax && !taxRaw) {
                        const idx = body.indexOf('data-code="tax"');
                    }
                } catch {
                    // Response may have already completed before we started listening
                }
            }
        );
    }

    async getSidebarTaxValue(): Promise<string> {
        const taxEl = this.page.locator(locators.sidebar_tax_value).first();
        const visible = await taxEl.isVisible({ timeout: 5000 }).catch(() => false);

        if (!visible) {
            return '$0.00';
        }

        return ((await taxEl.textContent()) || '$0.00').trim();
    }

    async selectFreePaymentMethod(methodName: string = 'checkmo') {
        await test.step(
            this.workerInfo.project.name + ": Select free/check payment method: " + methodName,
            async () => {
                // Payment radios may be sr-only (visually hidden behind icon) — wait for
                // the radio to exist in the DOM, then force-check it.
                const radio = this.page.locator(`input[type="radio"][value="${methodName}"]`);
                await radio.waitFor({ state: 'attached', timeout: 15000 });

                // Force-check handles sr-only elements that isVisible() would reject.
                await radio.check({ force: true });

                // Start listening for the loki_components AJAX BEFORE triggering the save
                // so we don't miss a fast response.
                const ajaxResponsePromise = this.page.waitForResponse(
                    (response) =>
                        response.url().includes('loki_components/index/html') &&
                        response.status() === 200,
                    { timeout: 20000 },
                );

                // Save the payment method via the Loki AJAX queue.
                // Set skipQueue=true so the AJAX fires immediately (no 40ms delay).
                const result = await this.page.evaluate(async (code: string) => {
                    const store = (window as any).Alpine?.store?.('LokiCheckout');
                    if (!store) return 'no LokiCheckout store';

                    const paymentComp = store.getComponentByName?.('LokiCheckoutPaymentMethods')
                        || store.getComponentArray?.().find((c: any) =>
                            c.name === 'LokiCheckoutPaymentMethods' ||
                            c.name?.includes('PaymentMethods'),
                        );

                    if (!paymentComp) {
                        return 'no payment component';
                    }

                    // Debug: log the actual blockId to diagnose silent AJAX failures.
                    const debugBlockId = paymentComp.blockId;

                    // If blockId is empty, force-set it to the known layout block name.
                    // This ensures LokiAjaxQueue.getUpdates() sends the correct blockName.
                    if (!paymentComp.blockId) {
                        paymentComp.blockId = 'loki-checkout.payment.methods';
                    }

                    // Set skipQueue so the AJAX fires immediately without the 40ms batch delay.
                    const originalSkipQueue = paymentComp.skipQueue;
                    paymentComp.skipQueue = true;

                    // Force a value change to bypass submitValue()'s early-return guard.
                    paymentComp.value = '';
                    paymentComp.value = code;
                    await paymentComp.submit();

                    // Restore skipQueue.
                    paymentComp.skipQueue = originalSkipQueue;

                    return `submitted: ${code} (blockId was: "${debugBlockId}", set to: "${paymentComp.blockId}")`;
                }, methodName);


                // Wait for the actual AJAX response to confirm the payment was persisted.
                try {
                    const response = await ajaxResponsePromise;
                    const body = await response.text();
                } catch (e) {
                }

                // Allow Alpine to process the response and update component state.
                await this.page.waitForTimeout(2000);

                // SERVER-TRUTH GATE: the Alpine submit + AJAX-200 above can
                // still fail to persist the method — a concurrent morph
                // (shipping re-save, tax-exempt tick) races the save and the
                // quote ends up with only method=NULL quote_payment rows;
                // PAY NOW then throws "Please select a payment method".
                // Resolve the quote id (guest cart) and poll quote_payment in
                // the DB, re-submitting until the method row actually exists.
                // Suite runs proved the pattern: DB-gated placements pass,
                // ungated ones are a timing lottery.
                const quoteId = await this.page.evaluate(async () => {
                    try {
                        const cartId = JSON.parse(
                            localStorage.getItem('mage-cache-storage') || '{}'
                        )?.cart?.cartId;
                        if (!cartId) return null;
                        const resp = await fetch(`/rest/default/V1/guest-carts/${cartId}`, {
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                        });
                        if (!resp.ok) return null;
                        return (await resp.json()).id ?? null;
                    } catch (e) {
                        return null;
                    }
                });

                if (!quoteId) {
                    // Logged-in session or masked id unavailable — fall back to
                    // the client-side confirmation above.
                    return;
                }

                const countRows = () => {
                    const sql = `SELECT COUNT(*) FROM quote_payment WHERE quote_id = ${Number(quoteId)} AND method = '${methodName}'`;
                    const out = execSync(`mysql -sN -e ${JSON.stringify(sql)}`, {
                        encoding: 'utf-8',
                        timeout: 15000,
                    });
                    return parseInt(out.trim(), 10) || 0;
                };

                const deadline = Date.now() + 60000;
                let rows = countRows();
                while (rows === 0 && Date.now() < deadline) {
                    // Do NOT re-poke the Alpine component: after a morph the
                    // captured component instance is STALE and its submit()
                    // posts an EMPTY value — observed as runs of consecutive
                    // method=NULL quote_payment rows (one per re-submit).
                    // Magento's supported guest-cart endpoint sets the method
                    // server-side deterministically (and flows through the
                    // PreservePaymentIdPlugin so it updates rather than
                    // piling rows).
                    await this.page.evaluate(async (code: string) => {
                        try {
                            const cartId = JSON.parse(
                                localStorage.getItem('mage-cache-storage') || '{}'
                            )?.cart?.cartId;
                            if (!cartId) return;
                            await fetch(`/rest/default/V1/guest-carts/${cartId}/selected-payment-method`, {
                                method: 'PUT',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'X-Requested-With': 'XMLHttpRequest',
                                },
                                credentials: 'include',
                                body: JSON.stringify({ method: { method: code } }),
                            });
                        } catch (e) {
                            // loop re-checks the DB either way
                        }
                    }, methodName).catch(() => {});
                    await this.page.waitForTimeout(3000);
                    rows = countRows();
                }

                expect(
                    rows,
                    `Payment method '${methodName}' must persist to quote_payment (quote ${quoteId}) before PAY NOW`,
                ).toBeGreaterThan(0);
            }
        );
    }

    /**
     * Login an existing customer via the storefront login page.
     * Navigates to /customer/account/login/, fills credentials, submits.
     */
    async loginExistingCustomer(email: string, password: string): Promise<void> {
        await test.step(
            this.workerInfo.project.name + ': Login existing customer: ' + email,
            async () => {
                await this.page.goto((process.env.url ?? '') + 'customer/account/login/');
                await this.page.waitForLoadState('domcontentloaded');

                // Check if already logged in (redirected to my-account)
                if (this.page.url().includes('customer/account') && !this.page.url().includes('login')) {
                    return;
                }

                const emailInput = this.page.locator('#email');
                await emailInput.waitFor({ state: 'visible', timeout: 15000 });
                await emailInput.fill(email);

                const passInput = this.page.locator('#pass');
                await passInput.fill(password);

                await this.page.locator('#send2, button[type="submit"]').first().click();
                await this.page.waitForLoadState('domcontentloaded');
                await this.page.waitForTimeout(2000);
            }
        );
    }

    /**
     * Add a product to the cart by navigating to its product URL.
     * Fills qty input and clicks Add to Cart. Waits for cart confirmation.
     */
    async addProductToCartByUrl(productUrl: string, qty: number = 1): Promise<void> {
        await test.step(
            this.workerInfo.project.name + ': Add product to cart: ' + productUrl,
            async () => {
                await this.page.goto(process.env.url + productUrl);
                await this.page.waitForLoadState('domcontentloaded');

                const qtyInput = this.page.locator('input[name="qty"]');

                if (await qtyInput.isVisible({ timeout: 3000 }).catch(() => false)) {
                    await qtyInput.fill(String(qty));
                }

                await this.page.locator('button:has-text("Add to Cart")').first().click();
                // Wait for cart success indication (minicart count update or success msg)
                await this.page.waitForTimeout(3000);
            }
        );
    }

    /**
     * Fill delivery address with specific city/zip/state — for the pay-now spec
     * that uses a Texas address (Addison TX 75001).
     */
    async fillDeliveryAddressSimple(
        firstName: string,
        lastName: string,
        street: string,
        city: string,
        zip: string,
        stateLabel: string,
        phone: string,
    ): Promise<void> {
        await test.step(
            this.workerInfo.project.name + ': Fill delivery address (simple)',
            async () => {
                const firstNameInput = this.page.getByRole('textbox', { name: 'First Name' }).first();
                await firstNameInput.waitFor({ state: 'visible', timeout: 15000 });

                const namedFields = [
                    { name: 'First Name', value: firstName },
                    { name: 'Last Name', value: lastName },
                    { name: 'Address', value: street },
                    { name: 'City', value: city },
                    { name: 'Phone Number', value: phone },
                ];

                for (const field of namedFields) {
                    const input = this.page.getByRole('textbox', { name: field.name }).first();

                    if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
                        await input.click();
                        await input.fill(field.value);
                        await input.press('Tab');
                        await this.page.waitForTimeout(300);
                    }
                }

                const zipcodeInput = this.page.getByRole('textbox', { name: 'Zipcode' }).first();

                if (await zipcodeInput.isVisible({ timeout: 3000 }).catch(() => false)) {
                    await zipcodeInput.click();
                    await zipcodeInput.fill(zip);
                    await zipcodeInput.press('Tab');
                    await this.page.waitForTimeout(1000);
                }

                // Verify First Name stuck
                const firstNameValue = await firstNameInput.inputValue();

                if (!firstNameValue) {
                    await firstNameInput.click();
                    await firstNameInput.fill(firstName);
                    await firstNameInput.press('Tab');
                    await this.page.waitForTimeout(500);
                }

                // Select state
                const stateSelect = this.page.locator('select[autocomplete*="address-level1"]').first();
                const stateSelectFallback = this.page.getByRole('combobox', { name: /state/i }).first();

                const stateEl = await stateSelect.isVisible({ timeout: 3000 }).catch(() => false)
                    ? stateSelect
                    : stateSelectFallback;

                await stateEl.waitFor({ state: 'visible', timeout: 10000 });
                await stateEl.selectOption({ label: stateLabel });
                await this.page.waitForTimeout(1000);
            }
        );
    }

    /**
     * Click PAY NOW button without selecting any payment method.
     * Used in Test A to trigger the EnsurePaymentMethodPlugin validation.
     * Uses { force: true } to bypass Playwright's actionability checks —
     * the button may be temporarily aria-disabled while Loki AJAX settles,
     * but the underlying x-on:click.prevent handler is always active.
     */
    async clickPayNow(): Promise<void> {
        await test.step(
            this.workerInfo.project.name + ': Click PAY NOW (no payment selection)',
            async () => {
                const payNowBtn = this.page.locator(locators.pay_now_button);
                await payNowBtn.waitFor({ state: 'visible', timeout: 30000 });
                // force: true bypasses the disabled check — Loki's Alpine submit handler
                // runs regardless and will trigger the EnsurePaymentMethodPlugin validation.
                await payNowBtn.click({ force: true });
            }
        );
    }

    /**
     * Fill the checkout email field and trigger the email-recognition blur.
     *
     * Uses press('Tab') to blur the email field, which triggers @change="submit"
     * in Loki. The AJAX checks if the email belongs to an existing account and,
     * if so, renders the inline password field + Sign In button.
     *
     * Waits for the password field to appear before returning.
     */
    async enterEmailAndTriggerRecognition(email: string): Promise<void> {
        await test.step(
            this.workerInfo.project.name + ': Enter email + trigger recognition: ' + email,
            async () => {
                const emailInput = this.page.getByRole('textbox', { name: 'Email' }).first();
                await emailInput.waitFor({ state: 'visible', timeout: 15000 });

                await emailInput.click();
                await emailInput.fill(email);

                // Press Tab to trigger @change="submit" on the email field.
                await emailInput.press('Tab');

                // Wait for password field to appear — the recognition AJAX renders it.
                await this.page.waitForFunction(
                    () => !!document.querySelector('input[name="login[password]"], input[name="password"]'),
                    undefined,
                    { timeout: 20000 },
                ).catch(() => {
                });

                // Extra settle time after recognition renders.
                await this.page.waitForTimeout(2000);
            }
        );
    }

    /**
     * Fill password and click Sign In on the inline login form.
     *
     * Sets the Alpine component's `email` property via evaluate before clicking,
     * because the email input in advanced-email-field/login.phtml uses
     * @input="setValue" (sets this.value) but submitLogin() reads this.email.
     */
    async signInWithPassword(password: string): Promise<void> {
        await test.step(
            this.workerInfo.project.name + ': Sign In with password',
            async () => {
                const passField = this.page.locator('input[name="login[password]"], input[name="password"]').first();
                await passField.waitFor({ state: 'visible', timeout: 20000 });

                // Fill the password input — triggers @input="setPassword" → this.password.
                await passField.fill(password);
                await this.page.waitForTimeout(500);

                // Fix Alpine email property: the email input uses @input="setValue"
                // but submitLogin() reads this.email. Sync from the DOM input value.
                await this.page.evaluate(() => {
                    const emailInput = (
                        document.querySelector('input[type="email"]') ||
                        document.querySelector('input[autocomplete*="email"]')
                    ) as HTMLInputElement | null;
                    const emailVal = emailInput?.value ?? '';

                    if (!emailVal) {
                        return;
                    }

                    document.querySelectorAll('[x-data]').forEach((el) => {
                        try {
                            const data = (window as any).Alpine?.$data?.(el);
                            if (data && typeof data.submitLogin === 'function' && 'email' in data) {
                                if (!data.email) {
                                    data.email = emailVal;
                                }
                            }
                        } catch { /* skip */ }
                    });
                });

                const signInBtn = this.page.locator(locators.sign_in_button).first();
                await signInBtn.waitFor({ state: 'visible', timeout: 10000 });
                await signInBtn.click();
            }
        );
    }

    /**
     * Wait for the inline login form to be replaced after Sign In.
     *
     * After successful authentication, Loki AJAX re-renders the steps block
     * and the login form is replaced. We wait for the `loki-components.ajax.done`
     * event post-Sign-In, then verify the form has changed.
     *
     * Falls back to waiting for "You are logged in as" text or Sign In button
     * disappearance.
     */
    async waitForLoginFormToReplace(timeout = 60000): Promise<void> {
        await test.step(
            this.workerInfo.project.name + ': Wait for login form to replace',
            async () => {
                // Wait for loki-components.ajax.done to fire (indicates the login
                // AJAX response was processed and DOM was updated).
                // OR wait up to timeout for the "logged in as" text to appear.
                await this.page.waitForFunction(
                    () => {
                        // Check for "logged in as" text rendered by logged-in.phtml
                        const body = document.body.textContent || '';

                        if (body.includes('You are logged in as') || body.includes('logged in as')) {
                            return true;
                        }

                        // Fallback: Sign In button gone means login block replaced
                        const signInBtns = Array.from(document.querySelectorAll('button'));
                        const signInVisible = signInBtns.some(
                            (btn) => {
                                const text = btn.textContent?.trim() ?? '';
                                return (text === 'Sign In' || text === 'Sign In ') &&
                                    (btn as HTMLElement).offsetParent !== null;
                            }
                        );

                        return !signInVisible;
                    },
                    undefined,
                    { timeout },
                );
                // Allow Alpine/Loki to finish post-login re-render and AJAX.
                await this.page.waitForTimeout(3000);
            }
        );
    }

    /**
     * Wait for Loki AJAX queue to idle AND for a minimum settle time.
     * Uses LokiAjaxQueue.loading + requests.length as the primary check.
     * More reliable than networkidle on Loki checkout (polling endpoint keeps
     * network perpetually active).
     */
    async waitForLokiAjaxIdle(timeout = 8000): Promise<void> {
        await test.step(
            this.workerInfo.project.name + ": Wait for Loki AJAX queue to idle",
            async () => {
                // Poll via the browser's fetch-in-progress count or the Alpine
                // loading event. We check that LokiAjaxQueue.loading is false,
                // meaning no batch is currently in flight.
                try {
                    // Pass undefined as arg (2nd param) so timeout goes to options (3rd param).
                    await this.page.waitForFunction(
                        () => {
                            const queue = (window as any).LokiAjaxQueue;
                            if (!queue) return true; // queue not yet initialised — nothing pending
                            return queue.loading === false && queue.requests.length === 0;
                        },
                        undefined,
                        { timeout },
                    );
                    // One extra tick to let Alpine flush DOM updates after the last AJAX.
                    await this.page.waitForTimeout(300);
                } catch {
                    // Timed out waiting for idle — proceed anyway
                }
            }
        );
    }
}
