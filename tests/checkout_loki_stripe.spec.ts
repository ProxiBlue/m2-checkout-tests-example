import { test, describe, expect } from "../fixtures";

/**
 * Loki Checkout + Stripe Payment Element — end-to-end test.
 *
 * Loki replaces the standard Magento checkout with an Alpine.js-based
 * single-page Shopify-style flow. Selectors differ from the KO-based checkout.
 *
 * Requirements:
 *   - Cart total > $100 (minimum order amount)
 *   - Stripe in test mode with test publishable key
 *   - ShipperHQ returning rates for US addresses
 */
describe("Loki Checkout with Stripe payment", () => {
    // Loki checkout is on the `loki` branch — not yet merged to live/uat.
    // Unskip when switching to loki branch (see memory: loki_tests_skipped).

    test.setTimeout(180000);

    /**
     * Add a product with qty high enough to pass $100 minimum order.
     * Uses the compact ball valve ($69.99) × 2 = $139.98.
     * Adds via REST API to avoid flaky form-submit timing.
     */
    test.beforeEach(async ({ page }) => {
        // Add product id 924 (4" compact ball valve, $69.99) qty 2 via API
        const added = await page.evaluate(async () => {
            const formKey = (document.querySelector(
                'input[name="form_key"]'
            ) as HTMLInputElement)?.value;
            if (!formKey) {
                // Load any page to get a form key
                return false;
            }
            const formData = new FormData();
            formData.append("product", "924");
            formData.append("qty", "2");
            formData.append("form_key", formKey);
            const resp = await fetch("/checkout/cart/add/", {
                method: "POST",
                body: formData,
                redirect: "follow",
            });
            return resp.ok;
        });

        if (!added) {
            // Fallback: navigate to product page and add via form
            await page.goto(
                process.env.url +
                    "4-compact-ball-valve-gray-socket-f01400gs.html"
            );
            await page.waitForLoadState("domcontentloaded");
            await page.locator('input[name="qty"]').fill("2");
            await page.locator('button:has-text("Add to Cart")').click();
            // Wait for page to settle after add (Hyva may redirect or show AJAX message)
            await page.waitForTimeout(5000);
        }
    });

    test("it can complete checkout with Stripe test card", async ({
        page,
    }) => {
        // ----- Navigate to Loki checkout -----
        await page.goto(process.env.url + "checkout/");
        await page.waitForLoadState("domcontentloaded");

        // Wait for Loki AJAX components to load
        await page.waitForTimeout(3000);

        // ----- Fill email -----
        // Loki loads components via AJAX — wait for the email input to appear
        const emailInput = page.getByRole("textbox", { name: "Email" });
        await emailInput.waitFor({ state: "visible", timeout: 30000 });
        await emailInput.click();
        await emailInput.fill("loki-test@example.com");
        await emailInput.press("Tab");

        // Wait for any AJAX triggered by email blur (login check, component refresh)
        await page.waitForTimeout(3000);

        // ----- Fill delivery address -----
        // Loki uses floating labels (not placeholders). Use role-based selectors.
        // Wait for First Name to be stable after potential AJAX refresh
        const firstNameInput = page.getByRole("textbox", { name: "First Name" }).first();
        await firstNameInput.waitFor({ state: "visible", timeout: 10000 });

        const fields = [
            { name: "First Name", value: "Test" },
            { name: "Last Name", value: "Buyer" },
            { name: "Address", value: "123 Main St" },
            { name: "Zipcode", value: "38654" },
            { name: "City", value: "Olive Branch" },
            { name: "Phone Number", value: "8067220086" },
        ];

        for (const field of fields) {
            const input = page.getByRole("textbox", { name: field.name }).first();
            await input.click();
            await input.fill(field.value);
            await input.press("Tab");
            await page.waitForTimeout(300);
        }

        // Verify First Name actually stuck (Loki AJAX can wipe it)
        const firstNameValue = await firstNameInput.inputValue();
        if (!firstNameValue) {
            await firstNameInput.click();
            await firstNameInput.fill("Test");
            await firstNameInput.press("Tab");
            await page.waitForTimeout(500);
        }

        // Select state — Mississippi
        // Loki renders select options with empty values — Alpine tracks via text.
        // Must set through Alpine component directly.
        // NOTE: accessible name is "State" in the current Loki DOM — the old
        // "State/Province" label hangs selectOption forever (actionTimeout: 0).
        const stateSelect = page
            .getByRole("combobox", { name: "State" })
            .first();
        await stateSelect.selectOption({ label: "Mississippi" });
        await page.waitForTimeout(500);

        // Set region via Alpine component — must use numeric region_id (35 = Mississippi)
        // Loki's RegionRepository.saveValue() only sets region_id if value is numeric
        await page.evaluate(() => {
            const store = (window as any).Alpine?.store?.("LokiCheckout");
            if (!store) return;
            const components = store.getComponentArray?.() || [];
            const regionComp = components.find(
                (c: any) => c.fieldName === "region" || c.fieldName === "region_id"
            );
            if (regionComp) {
                regionComp.value = "35"; // 35 = Mississippi region_id
                regionComp.valid = true;
                regionComp.post("35");
            }
        });
        await page.waitForTimeout(2000);

        // ----- Wait for shipping rates -----
        // Loki loads ShipperHQ rates via AJAX after address is filled
        await page.waitForFunction(
            () => {
                return (
                    document.querySelectorAll(
                        'input[type="radio"][name*="shipping"]'
                    ).length > 0
                );
            },
            { timeout: 45000 }
        );

        // Select first shipping rate
        const shippingRadio = page
            .locator('input[type="radio"][name*="shipping"]')
            .first();
        await shippingRadio.check();

        // Wait for AJAX queue to flush the shipping selection
        await page.waitForTimeout(3000);

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

        // Wait for Stripe to validate the card
        await page.waitForTimeout(3000);

        // ----- Verify PAY NOW is enabled -----
        // Check all Loki components are valid
        const allValid = await page.evaluate(() => {
            const store = (window as any).Alpine?.store?.("LokiCheckout");
            if (!store) return false;
            return store.hasOnlyValidComponents(["one", "any"]);
        });


        if (!allValid) {
            // Log invalid components for debugging
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

        // Wait for PAY NOW to become enabled (all components valid)
        // If it doesn't enable, log invalid components and fail clearly
        try {
            await expect(payNowBtn).toBeEnabled({ timeout: 20000 });
        } catch {
            const invalidInfo = await page.evaluate(() => {
                const store = (window as any).Alpine?.store?.("LokiCheckout");
                if (!store) return "No LokiCheckout store";
                return store
                    .getInvalidComponentArray(["one", "any"])
                    .map((c: any) => `${c.name}(${c.fieldName || "no-field"})`)
                    .join(", ");
            });
            throw new Error(
                `PAY NOW button disabled. Invalid components: ${invalidInfo}`
            );
        }

        await payNowBtn.click();

        // ----- Wait for order placement -----
        // Loki navigates to /loki_checkout/index/finalize/ then redirects
        // to success page. Wait for any navigation away from checkout.
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

        // If we landed on finalize, wait for it to redirect to success
        if (page.url().includes("finalize")) {
            await page.waitForURL(
                (url) => !url.pathname.includes("finalize"),
                { timeout: 60000 }
            );
        }

        // Log where we ended up

        // Check for success or capture the error
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
            const orderMatch = orderText?.match(/#\s*is:\s*(\S+)/i) || orderText?.match(/order\s*#?\s*(?:is:?\s*)?(\w+)/i);
            const orderNumber = orderMatch ? orderMatch[1].replace(/\.$/, "") : orderText?.substring(0, 80);
        } else {
            // Capture page content for debugging
            const bodyText = await page
                .locator("body")
                .textContent({ timeout: 5000 });
            expect(finalUrl, "Expected success page redirect").toContain(
                "success"
            );
        }
    });
});
