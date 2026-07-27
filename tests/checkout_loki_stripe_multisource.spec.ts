import { test, describe, expect } from "../fixtures";

/**
 * Loki Checkout + Stripe — multi-source shipment end-to-end test.
 *
 * Uses 3 products that ship from different ShipperHQ sources (PPS Olive Branch MS
 * + GF Easton PA), triggering the multi-shipment pager UI.
 *
 * Products:
 *   - 3/4" x 10' Schedule 40 Clear PVC Pipe (PL-007-10) — $69.99
 *   - 3/4" PVC True Union Ball Valve 1407GST — $10.99–$14.00
 *   - 1/2" x 10' Plain End Schedule 40 PVC Pipe (H0400050PW1000) — $2.99
 */
describe("Loki Checkout — multi-source shipment with Stripe", () => {
    // Loki checkout is on the `loki` branch — not yet merged to live/uat.
    // Unskip when switching to loki branch (see memory: loki_tests_skipped).

    test.setTimeout(300000);

    /**
     * Add 3 products from different warehouse sources.
     * Uses product pages but minimizes wait time.
     * Product IDs: 7518 (Clear PVC Pipe), 6631 (Ball Valve), 7328 (PVC Pipe)
     */
    test.beforeEach(async ({ page }) => {
        // Navigate to first product to get a session/form key
        await page.goto(
            process.env.url +
                "3-4-schedule-40-clear-pipe-pl-007.html"
        );
        await page.waitForLoadState("domcontentloaded");

        // Add all 3 products via REST API (faster than page navigation)
        const products = [
            { id: "7518", qty: "1" },
            { id: "6631", qty: "1" },
            { id: "7328", qty: "1" },
        ];

        for (const product of products) {
            await page.evaluate(
                async ({ pid, pqty }) => {
                    const formKey = (
                        document.querySelector(
                            'input[name="form_key"]'
                        ) as HTMLInputElement
                    )?.value;
                    if (!formKey) return false;
                    const formData = new FormData();
                    formData.append("product", pid);
                    formData.append("qty", pqty);
                    formData.append("form_key", formKey);
                    const resp = await fetch("/checkout/cart/add/", {
                        method: "POST",
                        body: formData,
                        redirect: "follow",
                    });
                    return resp.ok;
                },
                { pid: product.id, pqty: product.qty }
            );
            await page.waitForTimeout(1000);
        }
    });

    test("it can complete multi-source checkout with Stripe test card", async ({
        page,
    }) => {
        // ----- Navigate to Loki checkout -----
        await page.goto(process.env.url + "checkout/");
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(3000);

        // ----- Fill email -----
        const emailInput = page.getByRole("textbox", { name: "Email" });
        await emailInput.waitFor({ state: "visible", timeout: 30000 });
        await emailInput.click();
        await emailInput.fill("loki-multisource-test@example.com");
        await emailInput.press("Tab");
        await page.waitForTimeout(3000);

        // ----- Fill delivery address -----
        const firstNameInput = page
            .getByRole("textbox", { name: "First Name" })
            .first();
        await firstNameInput.waitFor({ state: "visible", timeout: 10000 });

        // Fill address fields EXCEPT state — fill state LAST after all AJAX settles
        const fields = [
            { name: "First Name", value: "Test" },
            { name: "Last Name", value: "MultiShip" },
            { name: "Address", value: "123 Main St" },
            { name: "City", value: "Olive Branch" },
            { name: "Phone Number", value: "8067220086" },
        ];

        for (const field of fields) {
            const input = page
                .getByRole("textbox", { name: field.name })
                .first();
            await input.click();
            await input.fill(field.value);
            await input.press("Tab");
            await page.waitForTimeout(300);
        }

        // Verify First Name stuck (Loki AJAX can wipe fields)
        const firstNameValue = await firstNameInput.inputValue();
        if (!firstNameValue) {
            await firstNameInput.click();
            await firstNameInput.fill("Test");
            await firstNameInput.press("Tab");
            await page.waitForTimeout(500);
        }

        // Fill zipcode — triggers AJAX
        const zipcodeInput = page.getByRole("textbox", { name: "Zipcode" }).first();
        await zipcodeInput.click();
        await zipcodeInput.fill("38654");
        await zipcodeInput.press("Tab");

        // Wait for zipcode AJAX to complete
        await page.waitForTimeout(5000);

        // Select state — Mississippi
        // Loki renders select options with empty value attributes — Alpine tracks
        // the selection via the option text through x-model. Must set via the
        // Alpine component directly using "Mississippi" as the value (text-based).
        // NOTE: accessible name is "State" in the current Loki DOM — the old
        // "State/Province" label hangs selectOption forever (actionTimeout: 0).
        const stateSelect = page
            .getByRole("combobox", { name: "State" })
            .first();
        await stateSelect.selectOption({ label: "Mississippi" });
        await page.waitForTimeout(500);

        // Set the Alpine component value to "Mississippi" and trigger post
        const regionSet = await page.evaluate(() => {
            const store = (window as any).Alpine?.store?.("LokiCheckout");
            if (!store) return "no store";
            const components = store.getComponentArray?.() || [];
            const regionComp = components.find(
                (c: any) => c.fieldName === "region" || c.fieldName === "region_id"
            );
            if (!regionComp) return "no region component. Fields: " + components.map((c: any) => c.fieldName || c.name).join(",");

            // Set value and mark valid WITHOUT triggering AJAX (no post/submit).
            // Rates are already loaded from zipcode. The backend will get
            // region_id from the address that was already saved during the
            // zipcode AJAX round-trip.
            regionComp.value = "35"; // 35 = Mississippi
            regionComp.valid = true;
            return "set to 35 (Mississippi), current value: " + regionComp.value;
        });
        await page.waitForTimeout(1000);

        // ----- Wait for shipping rates (multi-source) -----
        // Rates should already be loaded from zipcode fill.
        await page.waitForFunction(
            () => {
                return (
                    document.querySelectorAll(
                        'input[type="radio"][name*="shipping"]'
                    ).length > 0
                );
            },
            { timeout: 60000 }
        );

        // ----- Handle multi-source pager -----
        // Check if multi-source banner exists (partial text match)
        const multiSourceBanner = page.locator(
            '*:has-text("shipping from"):not(script):not(style)'
        ).first();
        const isMultiSource = await multiSourceBanner
            .isVisible({ timeout: 5000 })
            .catch(() => false);


        if (isMultiSource) {
            // Count total shipments from the step indicator (e.g. "Shipment 1 of 2")
            const stepText = await page
                .locator("text=/Shipment \\d+ of \\d+/")
                .first()
                .textContent({ timeout: 3000 })
                .catch(() => "");

            // Select shipping rate for first source. Restrict to VISIBLE
            // radios — ShipperHQ paginates shipments, radios for
            // non-current shipments are display:none.
            const firstRate = page
                .locator('input[type="radio"][name*="shipping"]:visible')
                .first();
            await firstRate.check();
            await page.waitForTimeout(2000);

            // Click Next to go to second source
            const nextButton = page
                .locator(
                    'button:has-text("Next"), [class*="pager"] button:last-child'
                )
                .first();
            if (await nextButton.isVisible({ timeout: 5000 }).catch(() => false)) {
                await nextButton.click();
                await page.waitForTimeout(3000);

                // Wait for second source shipping rates (visible = current shipment)
                await page.waitForFunction(
                    () => {
                        return Array.from(
                            document.querySelectorAll<HTMLElement>(
                                'input[type="radio"][name*="shipping"]'
                            )
                        ).some((el) => el.offsetParent !== null || el.getClientRects().length > 0);
                    },
                    { timeout: 30000 }
                );

                // Select shipping rate for second source
                const secondRate = page
                    .locator('input[type="radio"][name*="shipping"]:visible')
                    .first();
                await secondRate.check();
                await page.waitForTimeout(2000);

                // Check for a third source
                const nextButton2 = page
                    .locator(
                        'button:has-text("Next"), [class*="pager"] button:last-child'
                    )
                    .first();
                if (
                    await nextButton2
                        .isVisible({ timeout: 3000 })
                        .catch(() => false)
                ) {
                    await nextButton2.click();
                    await page.waitForTimeout(3000);

                    await page.waitForFunction(
                        () =>
                            document.querySelectorAll(
                                'input[type="radio"][name*="shipping"]'
                            ).length > 0,
                        { timeout: 30000 }
                    );

                    const thirdRate = page
                        .locator('input[type="radio"][name*="shipping"]:visible')
                        .first();
                    await thirdRate.check();
                    await page.waitForTimeout(2000);
                }
            }
        } else {
            // Single source — just select the first rate
            const shippingRadio = page
                .locator('input[type="radio"][name*="shipping"]')
                .first();
            await shippingRadio.check();
        }

        // Wait for AJAX queue to flush all shipping selections
        await page.waitForTimeout(5000);

        // ----- Select Stripe payment method -----
        const stripeRadio = page.locator(
            'input[type="radio"][value="stripe_payments"]'
        );
        await stripeRadio.check();

        // Wait for Stripe Elements iframe to load
        await page.waitForSelector(
            'iframe[title="Secure payment input frame"]',
            { state: "visible", timeout: 20000 }
        );
        await page.waitForTimeout(2000);

        // ----- Fill Stripe Payment Element -----
        const stripeFrame = page.frameLocator(
            'iframe[title="Secure payment input frame"]'
        );

        // Card number
        const cardNumber = stripeFrame.locator(
            '[name="number"], input[placeholder*="card number" i], #Field-numberInput'
        );
        await cardNumber.waitFor({ state: "visible", timeout: 15000 });
        await cardNumber.click();
        await cardNumber.fill("4242424242424242");

        // Expiry
        const expiry = stripeFrame.locator(
            '[name="expiry"], input[placeholder*="MM" i], #Field-expiryInput'
        );
        await expiry.waitFor({ state: "visible", timeout: 5000 });
        await expiry.click();
        await expiry.fill("1230");

        // CVC
        const cvc = stripeFrame.locator(
            '[name="cvc"], input[placeholder*="CVC" i], #Field-cvcInput'
        );
        await cvc.waitFor({ state: "visible", timeout: 5000 });
        await cvc.click();
        await cvc.fill("123");

        // Tab out to trigger validation
        await cvc.press("Tab");
        await page.waitForTimeout(3000);

        // ----- Verify PAY NOW is enabled -----
        const allValid = await page.evaluate(() => {
            const store = (window as any).Alpine?.store?.("LokiCheckout");
            if (!store) return false;
            return store.hasOnlyValidComponents(["one", "any"]);
        });


        if (!allValid) {
            const invalidComponents = await page.evaluate(() => {
                const store = (window as any).Alpine?.store?.("LokiCheckout");
                if (!store) return [];
                return store
                    .getInvalidComponentArray(["one", "any"])
                    .map((c: any) => ({
                        name: c.name,
                        valid: c.valid,
                        fieldName: c.fieldName,
                    }));
            });
        }

        // ----- Click PAY NOW -----
        const payNowBtn = page.locator(
            'button:has-text("PAY NOW"), button:has-text("Pay Now"), button:has-text("Place Order")'
        );

        try {
            await expect(payNowBtn).toBeEnabled({ timeout: 20000 });
        } catch {
            const invalidInfo = await page.evaluate(() => {
                const store = (window as any).Alpine?.store?.("LokiCheckout");
                if (!store) return "No LokiCheckout store";
                return store
                    .getInvalidComponentArray(["one", "any"])
                    .map(
                        (c: any) => `${c.name}(${c.fieldName || "no-field"})`
                    )
                    .join(", ");
            });
            throw new Error(
                `PAY NOW button disabled. Invalid components: ${invalidInfo}`
            );
        }

        await payNowBtn.click();

        // ----- Wait for order placement -----
        await page.waitForURL(
            (url) => {
                const path = url.pathname;
                return (
                    path.includes("success") ||
                    path.includes("finalize") ||
                    !path.includes("checkout")
                );
            },
            { timeout: 60000 }
        );

        // If on finalize, wait for redirect to success
        if (page.url().includes("finalize")) {
            await page.waitForURL(
                (url) => !url.pathname.includes("finalize"),
                { timeout: 60000 }
            );
        }


        await page.waitForLoadState("domcontentloaded");
        const finalUrl = page.url();

        if (finalUrl.includes("success")) {
            const successHeading = page.locator("h1").first();
            await expect(successHeading).toContainText(/thank you/i, {
                timeout: 10000,
            });
            const orderText = await page
                .locator(".checkout-success")
                .first()
                .textContent();
            const orderMatch =
                orderText?.match(/#\s*is:\s*(\S+)/i) ||
                orderText?.match(/order\s*#?\s*(?:is:?\s*)?(\w+)/i);
            const orderNumber = orderMatch
                ? orderMatch[1].replace(/\.$/, "")
                : orderText?.substring(0, 80);
        } else {
            const bodyText = await page
                .locator("body")
                .textContent({ timeout: 5000 });
            expect(finalUrl, "Expected success page redirect").toContain(
                "success"
            );
        }
    });
});
