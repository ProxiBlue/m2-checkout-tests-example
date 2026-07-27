import { test, describe, expect } from "../fixtures";

/**
 * Loki Checkout sidebar — shipping rate display test.
 *
 * Verifies the sidebar totals update when shipping rates are selected,
 * for both single-source and multi-source shipments.
 *
 * Bug: sidebar shows Shipping Rate $0.00 after selecting a rate in
 * multi-source checkout (ShipperHQ splits into 2+ shipments).
 */
describe("Loki Checkout sidebar shipping totals", () => {
    // Loki checkout is on the `loki` branch — not yet merged to live/uat.
    // Unskip when switching to loki branch (see memory: loki_tests_skipped).
    test.setTimeout(300000);

    /**
     * Helper: fill checkout address fields and set region via Alpine component.
     */
    async function fillAddress(page: any) {
        const emailInput = page.getByRole("textbox", { name: "Email" });
        await emailInput.waitFor({ state: "visible", timeout: 30000 });
        await emailInput.click();
        await emailInput.fill("sidebar-test@example.com");
        await emailInput.press("Tab");
        await page.waitForTimeout(3000);

        const firstNameInput = page
            .getByRole("textbox", { name: "First Name" })
            .first();
        await firstNameInput.waitFor({ state: "visible", timeout: 10000 });

        const fields = [
            { name: "First Name", value: "Test" },
            { name: "Last Name", value: "Sidebar" },
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

        // Fill zipcode — triggers ShipperHQ rate fetch
        const zipcodeInput = page
            .getByRole("textbox", { name: "Zipcode" })
            .first();
        await zipcodeInput.click();
        await zipcodeInput.fill("38654");
        await zipcodeInput.press("Tab");
        await page.waitForTimeout(5000);

        // Set region via Alpine component (region_id 35 = Mississippi).
        // NOTE: the combobox accessible name is "State" in the current Loki
        // DOM — the old "State/Province" label no longer exists. With
        // actionTimeout: 0 a stale name makes selectOption hang until the
        // 300s test timeout.
        const stateSelect = page
            .getByRole("combobox", { name: "State" })
            .first();
        await stateSelect.selectOption({ label: "Mississippi" });
        await page.evaluate(() => {
            const store = (window as any).Alpine?.store?.("LokiCheckout");
            if (!store) return;
            const components = store.getComponentArray?.() || [];
            const regionComp = components.find(
                (c: any) =>
                    c.fieldName === "region" || c.fieldName === "region_id"
            );
            if (regionComp) {
                regionComp.value = "35";
                regionComp.valid = true;
                regionComp.post("35");
            }
        });
        await page.waitForTimeout(2000);
    }

    /**
     * Helper: get the sidebar shipping rate text.
     */
    async function getSidebarShippingRate(page: any): Promise<string> {
        const shippingValue = page.locator(
            'dd[class*="shipping"], [class*="shipping_rate"] + dd, [class*="Shipping Rate"] + dd'
        );
        // Fallback: find the dd after "Shipping Rate" dt
        const allDts = page.locator("dt");
        const count = await allDts.count();
        for (let i = 0; i < count; i++) {
            const dtText = await allDts.nth(i).textContent();
            if (dtText?.includes("Shipping")) {
                const dd = page.locator(`dt:nth-of-type(${i + 1}) + dd`);
                if (await dd.isVisible().catch(() => false)) {
                    return (await dd.textContent()) || "$0.00";
                }
            }
        }
        // Last resort: evaluate
        return page.evaluate(() => {
            const dts = document.querySelectorAll("dt");
            for (const dt of dts) {
                if (dt.textContent?.includes("Shipping")) {
                    const dd = dt.nextElementSibling;
                    if (dd?.tagName === "DD") {
                        return dd.textContent?.trim() || "$0.00";
                    }
                }
            }
            return "$0.00";
        });
    }

    /**
     * Regression: when the customer switches from one shipping method to
     * another AFTER selecting a payment method, the Loki framework cascades
     * target updates through the shipperhq-enhanced component into the
     * payment-methods component, which (pre-fix) resets payment.methods.value
     * to null. Clicking PAY NOW then surfaces "Enter a valid payment method
     * and try again" because the backend's placeOrder validator sees no
     * payment selected.
     *
     * Captured from a screen recording: see ai/Peek 2026-06-18 09-54.mp4
     *
     * This test exercises the bug at the runtime-state level (without going
     * through order placement, which is env-blocked here):
     *   1. Fill address, wait for shipping rates
     *   2. Select shipping A, select payment checkmo
     *   3. Switch to shipping B
     *   4. Assert payment.methods.value still = "checkmo" AND the DOM radio
     *      for checkmo is still checked.
     */
    test("payment method selection survives a shipping method switch", async ({
        page, lokiCheckoutPage, customerData,
    }) => {
        // Single product + single-source destination = predictable shipping
        // topology. The 1430GST + ALEXANDRIA MN combo has been verified
        // (manual + earlier passing run) to return 3 FedEx rates (Ground / 2nd
        // Day / Standard Overnight). One shipment, multiple methods to swap
        // between — the cleanest surface for this regression.
        await page.goto(
            process.env.url +
                "3-pvc-true-union-ball-valve-gray-epdm-socket-1430gs.html"
        );
        await page.waitForLoadState("domcontentloaded");
        await page.locator('button:has-text("Add to Cart")').first().click();
        await page.waitForTimeout(3000);

        // Use the page-object's fill helper — the file-local `fillAddress`
        // above expects a "State/Province" combobox that no longer exists
        // in the current loki DOM. The POM method uses autocomplete-attribute
        // selectors that work today and is shared with the tax-exempt suite.
        await lokiCheckoutPage.navigateTo();
        await lokiCheckoutPage.fillEmail(customerData.email);
        await lokiCheckoutPage.fillDeliveryAddressWithCompany(
            customerData,
            "Loki Test Corp",
            "ALEXANDRIA",
            "56308",
            "Minnesota",
        );

        // Wait for at least 1 shipping rate to render. We'd prefer 2 to swap
        // between, but multi-source can split into per-shipment groups; the
        // sibling test (further down) confirms at least 1 always shows up.
        await page.waitForFunction(
            () =>
                document.querySelectorAll(
                    'input[type="radio"][name*="shipping"]'
                ).length > 0,
            { timeout: 60000 }
        );

        const allShippingRadios = page.locator(
            'input[type="radio"][name*="shipping"]'
        );
        const rateCount = await allShippingRadios.count();
        test.skip(
            rateCount < 2,
            `Only ${rateCount} shipping rate(s) returned for this cart — the regression needs >=2 to swap between. Add a product mix that produces multiple rates and re-run.`
        );

        // 1. Select shipping method A (the first radio)
        await allShippingRadios.nth(0).check();
        await page.waitForTimeout(5000);

        // 2. Select payment method (Check / Money order = checkmo)
        const checkmoRadio = page.locator(
            'input[type="radio"][value="checkmo"]'
        );
        await checkmoRadio.waitFor({ state: "attached", timeout: 15000 });
        await checkmoRadio.check({ force: true });
        await page.waitForTimeout(4000);

        // 3. Sanity: payment.methods runtime value is 'checkmo' after selection
        const valueAfterPaymentSelection = await page.evaluate(() => {
            const arr =
                (window as any).Alpine?.store?.("LokiCheckout")?.getComponentArray?.() ||
                [];
            const payment = arr.find(
                (c: any) => c.blockId === "loki-checkout.payment.methods"
            );
            return payment ? payment.value ?? null : null;
        });
        expect(
            valueAfterPaymentSelection,
            "payment.methods.value should be 'checkmo' right after selection"
        ).toBe("checkmo");

        // 4. Switch to shipping method B (the second radio)
        await allShippingRadios.nth(1).check();
        await page.waitForTimeout(6000);

        // 5. REGRESSION ASSERTION: payment selection must survive the swap.
        //    Pre-fix: the value gets wiped to null and PAY NOW would fail
        //    with "Enter a valid payment method and try again".
        const valueAfterShippingSwitch = await page.evaluate(() => {
            const arr =
                (window as any).Alpine?.store?.("LokiCheckout")?.getComponentArray?.() ||
                [];
            const payment = arr.find(
                (c: any) => c.blockId === "loki-checkout.payment.methods"
            );
            return payment ? payment.value ?? null : null;
        });
        const radioStillChecked = await checkmoRadio.isChecked();

        expect.soft(
            valueAfterShippingSwitch,
            "Loki regression: payment.methods.value was wiped to null after shipping switch"
        ).toBe("checkmo");
        expect.soft(
            radioStillChecked,
            "Loki regression: checkmo radio is no longer checked after shipping switch"
        ).toBe(true);

        // 6. Most important assertion — the visible signal of the bug from the
        //    screen recording: a red "Enter a valid payment method" toast
        //    appears AND the form column gets wiped. Capture both.
        const errorToastVisible = await page.locator(
            'text=/enter a valid payment method/i',
        ).count();
        expect(
            errorToastVisible,
            'Loki regression: "Enter a valid payment method" error banner appeared after shipping switch'
        ).toBe(0);

        // Form column intact — checkmo radio's parent container should still
        // be in the DOM. If the bug fires, the framework re-renders the steps
        // column and the payment block disappears.
        const paymentBlockStillPresent = await page.locator(
            '#loki-checkout-payment-methods',
        ).count();
        expect(
            paymentBlockStillPresent,
            'Loki regression: payment-methods block was removed from the DOM after shipping switch'
        ).toBeGreaterThan(0);
    });

    /**
     * Multi-source variant of the regression above. The screen recording at
     * ai/Peek 2026-06-18 09-54.mp4 was captured with a multi-source cart
     * (SHIPMENT 1 OF 2 pagination visible). The cascade through
     * shipperhq-enhanced -> shipping.methods -> payment.methods is more
     * aggressive when shipments split, so this is the more likely surface
     * for the bug.
     *
     * Same assertion structure as the single-source test, but with a
     * 3-product cart that ShipperHQ will split across origins.
     */
    test("payment method selection survives a shipping switch in multi-source cart", async ({
        page, lokiCheckoutPage, customerData,
    }) => {
        await page.goto(
            process.env.url +
                "3-pvc-true-union-ball-valve-gray-epdm-socket-1430gs.html"
        );
        await page.waitForLoadState("domcontentloaded");

        // Pair a long PVC pipe (ships LTL freight from a depot) with a small
        // ball valve (ships FedEx with 3 rate options from a different origin)
        // to force dual-shipment AND multi-rate shipments. This combination
        // gives the cleanest surface for the regression: shipment 2 has 3
        // visible FedEx rates we can swap between.
        const products = [
            { id: "7328", qty: "1" }, // 10' Plain End Schedule 40 PVC Pipe (LTL)
            { id: "1430", qty: "1" }, // 3" PVC True Union Ball Valve (FedEx)
        ];

        for (const product of products) {
            await page.evaluate(
                async ({ pid, pqty }: { pid: string; pqty: string }) => {
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

        await lokiCheckoutPage.navigateTo();
        await lokiCheckoutPage.fillEmail(customerData.email);
        await lokiCheckoutPage.fillDeliveryAddressWithCompany(
            customerData,
            "Loki Test Corp",
            "Burlington",
            "05401",
            "Vermont",
        );

        await page.waitForFunction(
            () =>
                document.querySelectorAll(
                    'input[type="radio"][name*="shipping"]'
                ).length > 0,
            { timeout: 60000 }
        );

        // Multi-source UI paginates shipments. Shipment 1 here is the LTL
        // pipe (1 rate), shipment 2 is the FedEx valve (3 rates). Click the
        // "Next" pager so the FedEx shipment becomes visible — that's where
        // we have multiple rates to swap between.
        const nextBtn = page.locator('button:has-text("Next"), [class*="shipping-pager"] button').first();
        if (await nextBtn.count() > 0) {
            await nextBtn.click();
            await page.waitForTimeout(2000);
        }

        // Restrict to VISIBLE radios — in multi-source ShipperHQ paginates
        // shipments, so radios for non-current shipments are display:none.
        const visibleShippingRadios = page.locator(
            'input[type="radio"][name*="shipping"]:visible'
        );
        const visibleCount = await visibleShippingRadios.count();
        test.skip(
            visibleCount < 2,
            `Only ${visibleCount} VISIBLE shipping rate(s) — multi-source regression needs >=2 within the same shipment to swap. Adjust the product mix.`
        );

        // Select first VISIBLE shipping rate
        await visibleShippingRadios.nth(0).check();
        await page.waitForTimeout(5000);

        // Select Check / Money order
        const checkmoRadio = page.locator(
            'input[type="radio"][value="checkmo"]'
        );
        await checkmoRadio.waitFor({ state: "attached", timeout: 15000 });
        await checkmoRadio.check({ force: true });
        await page.waitForTimeout(4000);

        const valueAfterPaymentSelection = await page.evaluate(() => {
            const arr =
                (window as any).Alpine?.store?.("LokiCheckout")?.getComponentArray?.() ||
                [];
            const payment = arr.find(
                (c: any) => c.blockId === "loki-checkout.payment.methods"
            );
            return payment ? payment.value ?? null : null;
        });
        expect(
            valueAfterPaymentSelection,
            "multi-source: payment.methods.value should be 'checkmo' right after selection"
        ).toBe("checkmo");

        // Switch to a different VISIBLE shipping rate (still in shipment 1)
        await visibleShippingRadios.nth(1).check();
        await page.waitForTimeout(6000);

        const valueAfterShippingSwitch = await page.evaluate(() => {
            const arr =
                (window as any).Alpine?.store?.("LokiCheckout")?.getComponentArray?.() ||
                [];
            const payment = arr.find(
                (c: any) => c.blockId === "loki-checkout.payment.methods"
            );
            return payment ? payment.value ?? null : null;
        });
        const radioStillChecked = await checkmoRadio.isChecked();

        expect.soft(
            valueAfterShippingSwitch,
            "multi-source regression: payment.methods.value wiped after shipping switch"
        ).toBe("checkmo");
        expect.soft(
            radioStillChecked,
            "multi-source regression: checkmo radio no longer checked after shipping switch"
        ).toBe(true);

        const errorToastVisible = await page.locator(
            'text=/enter a valid payment method/i',
        ).count();
        expect(
            errorToastVisible,
            'multi-source regression: "Enter a valid payment method" error banner appeared after shipping switch'
        ).toBe(0);

        const paymentBlockStillPresent = await page.locator(
            '#loki-checkout-payment-methods',
        ).count();
        expect(
            paymentBlockStillPresent,
            'multi-source regression: payment-methods block removed from DOM after shipping switch'
        ).toBeGreaterThan(0);
    });

    test("sidebar updates shipping rate after selecting rate in multi-source checkout", async ({
        page,
    }) => {
        // Add 3 products from different sources
        await page.goto(
            process.env.url +
                "3-4-schedule-40-clear-pipe-pl-007.html"
        );
        await page.waitForLoadState("domcontentloaded");

        const products = [
            { id: "7518", qty: "1" },
            { id: "6631", qty: "1" },
            { id: "7328", qty: "1" },
        ];

        for (const product of products) {
            await page.evaluate(
                async ({ pid, pqty }: { pid: string; pqty: string }) => {
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

        // Go to checkout
        await page.goto(process.env.url + "checkout/");
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(3000);

        // Fill address
        await fillAddress(page);

        // Wait for shipping rates
        await page.waitForFunction(
            () =>
                document.querySelectorAll(
                    'input[type="radio"][name*="shipping"]'
                ).length > 0,
            { timeout: 60000 }
        );

        // Confirm sidebar shipping is $0.00 before selecting a rate
        const shippingBefore = await getSidebarShippingRate(page);

        // Select first shipping rate
        const shippingRadio = page
            .locator('input[type="radio"][name*="shipping"]')
            .first();
        await shippingRadio.check();

        // Poll for the sidebar update instead of a fixed sleep. The Loki
        // morph re-render triggered by the address/rate save can replace the
        // radio's DOM node mid-flight and drop the selection — re-check it
        // inside the poll if that happens. Verified manually (chrome-mcp):
        // selecting the LTL rate updates the sidebar to the rate amount
        // within a few seconds; a fixed 5s wait raced the morph.
        await expect
            .poll(
                async () => {
                    const stillChecked = await shippingRadio
                        .isChecked()
                        .catch(() => false);
                    if (!stillChecked) {
                        await shippingRadio.check().catch(() => {});
                    }
                    return getSidebarShippingRate(page);
                },
                {
                    message:
                        "Sidebar shipping rate should update after selecting a shipping method",
                    timeout: 45000,
                    intervals: [2000, 3000, 5000],
                }
            )
            .not.toBe("$0.00");

        const shippingAfter = await getSidebarShippingRate(page);

        // Verify it's a reasonable dollar amount
        const amount = parseFloat(shippingAfter.replace(/[^0-9.]/g, ""));
        expect(
            amount,
            "Sidebar shipping amount should be greater than zero"
        ).toBeGreaterThan(0);
    });
});
