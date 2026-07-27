import { test, describe, expect } from "../fixtures";

/**
 * Bug reproduction: SHQ returns no shipping rates for certain US addresses.
 *
 * Reproduces the state seen in ai/2026-06-08_12-34.png:
 *   - Address: 2611 COUNTY ROAD 45 SW, Alexandria MN 56308
 *   - Shipping method section empty after address fill
 *   - Payment section renders anyway (no guard on empty rates)
 *
 * Test FAILS when the bug is present (no rates returned within 45s).
 * Test PASSES when the bug is fixed (at least one rate appears).
 *
 * Compare: Mississippi 38654 works (used in other loki tests).
 * Minnesota 56308 does not — this test isolates that delta.
 */
describe("Loki Checkout - SHQ no rates bug", () => {
    test.setTimeout(180000);

    test.beforeEach(async ({ page }) => {
        // Navigate to product page directly — most reliable way to get form_key
        await page.goto(
            (process.env.url as string) + "4-compact-ball-valve-gray-socket-f01400gs.html"
        );
        await page.waitForLoadState("domcontentloaded");
        await page.locator('input[name="qty"]').fill("2");
        await page.locator('button:has-text("Add to Cart")').click();
        await page.waitForLoadState("networkidle");
    });

    test("SHQ returns rates for Minnesota address (2611 COUNTY ROAD 45 SW, Alexandria MN 56308)", async ({
        page,
    }) => {
        await page.goto((process.env.url as string) + "checkout/");
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(2000);

        // Fill email
        const emailInput = page.getByRole("textbox", { name: "Email" });
        await emailInput.waitFor({ state: "visible", timeout: 30000 });
        await emailInput.fill("shq-bug-test@example.com");
        await emailInput.press("Tab");
        await page.waitForTimeout(2000);

        // Fill delivery address — exact address from the bug screenshot.
        const firstNameInput = page.getByRole("textbox", { name: "First Name" }).first();
        await firstNameInput.waitFor({ state: "visible", timeout: 15000 });

        const fields = [
            { name: "First Name", value: "Test" },
            { name: "Last Name", value: "Person" },
            { name: "Address", value: "2611 COUNTY ROAD 45 SW" },
            { name: "Zipcode", value: "56308" },
            { name: "City", value: "Alexandria" },
            { name: "Phone Number", value: "3207620000" },
        ];

        for (const field of fields) {
            const input = page.getByRole("textbox", { name: field.name }).first();
            await input.click();
            await input.fill(field.value);
            await input.press("Tab");
            await page.waitForTimeout(200);
        }

        // Select state — Minnesota (region_id 33)
        const stateSelect = page.getByRole("combobox", { name: "State" }).first();
        await stateSelect.waitFor({ state: "visible", timeout: 10000 });
        await stateSelect.selectOption({ label: "Minnesota" });
        await page.waitForTimeout(500);

        // Force Alpine region component to register the value
        await page.evaluate(() => {
            const el = document.querySelector('[x-data*="region_id"]');
            if (!el) return;
            const regionComp = (window as any).Alpine?.getComponent(el);
            if (regionComp) {
                regionComp.value = "33"; // Minnesota
                regionComp.valid = true;
                regionComp.post("33");
            }
        });
        await page.waitForTimeout(1500);

        // Screenshot: address filled, before SHQ response
        await page.screenshot({ path: "ai/shq-bug-address-filled.png", fullPage: true });

        // Wait for SHQ rates — assertion that documents the bug.
        // Fails if no rates appear within 45s (bug present).
        // Passes once at least one rate appears (bug fixed).
        await expect
            .poll(
                async () =>
                    await page.locator('input[type="radio"][name*="shipping"]').count(),
                {
                    message:
                        "Expected SHQ shipping rates for MN 56308 — got none (bug present)",
                    timeout: 45000,
                    intervals: [2000, 3000, 5000],
                }
            )
            .toBeGreaterThan(0);

        // Screenshot: rates visible — only reached when bug is fixed
        await page.screenshot({ path: "ai/shq-bug-rates-visible.png", fullPage: true });
    });
});
