import { Page, TestInfo, test } from "@playwright/test";
import LokiCheckoutPage from "@checkout/pages/loki_checkout.page";
import * as lokiLocators from "@checkout/locators/loki_checkout.locator";
import * as locators from "../locators/checkoutStripeSaveCard.locator";

/**
 * Extends the base Loki checkout page with the guest save-card opt-in surface:
 * adding products by id (fast API-based cart seeding for multi-item scenarios)
 * and interacting with the Stripe Payment Element's native save-card toggle.
 */
export default class CheckoutStripeSaveCardPage extends LokiCheckoutPage {

    constructor(public page: Page, public workerInfo: TestInfo) {
        super(page, workerInfo);
    }

    /**
     * Add a product to the cart by entity id via the cart/add API — faster and less
     * flake-prone than navigating each product page individually (mirrors the
     * pattern used in checkout_loki_stripe_multisource.spec.ts's beforeEach).
     *
     * Requires a page that has already loaded a storefront document (for the
     * form_key input + session cookies) — navigates to the homepage first if the
     * page hasn't loaded anything yet (fresh test session starts on about:blank).
     */
    async addProductToCartById(productId: string, qty: string = '1'): Promise<void> {
        await test.step(
            this.workerInfo.project.name + `: Add product ${productId} (qty ${qty}) to cart via API`,
            async () => {
                if (this.page.url() === 'about:blank') {
                    await this.page.goto(process.env.url as string);
                    await this.page.waitForLoadState('domcontentloaded');
                }

                await this.page.evaluate(
                    async ({ pid, pqty }) => {
                        const formKey = (
                            document.querySelector('input[name="form_key"]') as HTMLInputElement
                        )?.value;
                        if (!formKey) {
                            return false;
                        }
                        const formData = new FormData();
                        formData.append('product', pid);
                        formData.append('qty', pqty);
                        formData.append('form_key', formKey);
                        const resp = await fetch('/checkout/cart/add/', {
                            method: 'POST',
                            body: formData,
                            redirect: 'follow',
                        });
                        return resp.ok;
                    },
                    { pid: productId, pqty: qty },
                );
                await this.page.waitForTimeout(1000);
            }
        );
    }

    /**
     * Locator for the Stripe Payment Element's native save-card toggle, scoped to
     * the secure payment iframe (same iframe as the card number/expiry/cvc fields).
     */
    private saveCardToggleLocator() {
        return this.page
            .frameLocator(lokiLocators.stripe_iframe)
            .getByRole('checkbox', { name: locators.save_card_toggle })
            .first();
    }

    async isSaveCardToggleVisible(): Promise<boolean> {
        return await this.saveCardToggleLocator().isVisible({ timeout: 10000 }).catch(() => false);
    }

    async tickSaveCardToggle(): Promise<void> {
        await test.step(
            this.workerInfo.project.name + ": Tick Stripe Payment Element native save-card toggle",
            async () => {
                const toggle = this.saveCardToggleLocator();
                await toggle.waitFor({ state: 'visible', timeout: 15000 });

                if (!(await toggle.isChecked().catch(() => false))) {
                    await toggle.check();
                }

                await this.page.waitForTimeout(500);
            }
        );
    }

    /**
     * Uncheck the Stripe Payment Element native save-card toggle — the opt-OUT path.
     * With Customer Session integration the toggle is rendered default-CHECKED, so
     * this is the action a guest takes to skip vaulting their card.
     */
    async untickSaveCardToggle(): Promise<void> {
        await test.step(
            this.workerInfo.project.name + ": Untick Stripe Payment Element native save-card toggle",
            async () => {
                const toggle = this.saveCardToggleLocator();
                await toggle.waitFor({ state: 'visible', timeout: 15000 });

                if (await toggle.isChecked().catch(() => false)) {
                    await toggle.uncheck();
                }

                await this.page.waitForTimeout(500);
            }
        );
    }

    /**
     * True when the save-card toggle is rendered in its checked state — used to
     * assert the default-CHECKED Customer Session UX before exercising opt-out.
     */
    async isSaveCardToggleChecked(): Promise<boolean> {
        return await this.saveCardToggleLocator().isChecked({ timeout: 10000 }).catch(() => false);
    }

    /**
     * Select shipping rate(s), transparently handling ShipperHQ's multi-source
     * pager when a cart's items ship from more than one warehouse (mirrors the
     * pager-walking logic in checkout_loki_stripe_multisource.spec.ts). Falls
     * back to the single-source path (selectShippingMethod()) when no pager
     * banner is present.
     */
    async selectShippingMethodHandlingMultiSource(): Promise<void> {
        await test.step(
            this.workerInfo.project.name + ": Select shipping method(s) — multi-source aware",
            async () => {
                await this.page.waitForFunction(
                    () => document.querySelectorAll('input[type="radio"][name*="shipping"]').length > 0,
                    undefined,
                    { timeout: 45000 },
                );

                const multiSourceBanner = this.page
                    .locator('*:has-text("shipping from"):not(script):not(style)')
                    .first();
                const isMultiSource = await multiSourceBanner.isVisible({ timeout: 5000 }).catch(() => false);

                if (!isMultiSource) {
                    await this.page.locator('input[type="radio"][name*="shipping"]').first().check();
                    await this.page.waitForTimeout(3000);
                    return;
                }

                // Walk up to 3 shipment pages, selecting the first visible rate on each.
                for (let shipment = 1; shipment <= 3; shipment++) {
                    const rate = this.page.locator('input[type="radio"][name*="shipping"]:visible').first();
                    await rate.check();
                    await this.page.waitForTimeout(2000);

                    const nextButton = this.page
                        .locator('button:has-text("Next"), [class*="pager"] button:last-child')
                        .first();

                    if (!(await nextButton.isVisible({ timeout: 3000 }).catch(() => false))) {
                        break;
                    }

                    await nextButton.click();
                    await this.page.waitForTimeout(3000);
                    await this.page.waitForFunction(
                        () => Array.from(
                            document.querySelectorAll<HTMLElement>('input[type="radio"][name*="shipping"]'),
                        ).some((el) => el.offsetParent !== null || el.getClientRects().length > 0),
                        undefined,
                        { timeout: 30000 },
                    );
                }

                await this.page.waitForTimeout(3000);
            }
        );
    }
}
