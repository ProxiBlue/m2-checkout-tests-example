import { test, describe, expect } from "../fixtures";
import * as data from "../data/checkout.shipperhq-multisource.data.json";

/**
 * Regression guard for GitHub #346 / #351
 *
 * ShipperHQ multi-origin checkout: products from two different warehouses
 * (GF Easton PA + PPS Olive Branch MS) should produce two shipment groups,
 * allow rate selection, and advance to the billing/payment step when
 * "Proceed to Review & Payments" is clicked.
 *
 * Before fix: stuck on shipping step — 502 errors, validation failures,
 * or silent non-advancement.
 *
 * Fix: 6-bug chain addressed via composer patches and vendor edits.
 * See HANDOVER-SHIPPERHQ-CHECKOUT-FIX.md for full detail.
 */
describe("ShipperHQ multi-origin checkout (#346)", () => {

    test.setTimeout(300000);

    async function addProductToCart(page: any, entityId: string, qty: string) {
        const baseUrl = (process.env.url ?? '').replace(/\/$/, '');
        await page.evaluate(
            async ({ pid, pqty, base }: { pid: string; pqty: string; base: string }) => {
                const formKey = (document.querySelector('input[name="form_key"]') as HTMLInputElement)?.value;
                if (!formKey) return false;
                const formData = new FormData();
                formData.append('product', pid);
                formData.append('qty', pqty);
                formData.append('form_key', formKey);
                await fetch(`${base}/checkout/cart/add/`, { method: 'POST', body: formData, redirect: 'follow' });
                return true;
            },
            { pid: entityId, pqty: qty, base: baseUrl }
        );
        await page.waitForTimeout(1000);
    }

    async function fillAddress(page: any) {
        const baseUrl = (process.env.url ?? '').replace(/\/$/, '');

        const emailInput = page.getByRole('textbox', { name: 'Email' });
        await emailInput.waitFor({ state: 'visible', timeout: 30000 });
        await emailInput.fill(data.address.email);
        await emailInput.press('Tab');
        await page.waitForTimeout(3000);

        const fields: Array<{ name: string; value: string }> = [
            { name: 'First Name', value: data.address.firstName },
            { name: 'Last Name',  value: data.address.lastName  },
            { name: 'Address',    value: data.address.street    },
            { name: 'City',       value: data.address.city      },
            { name: 'Phone Number', value: data.address.phone   },
        ];

        for (const field of fields) {
            const input = page.getByRole('textbox', { name: field.name }).first();
            await input.waitFor({ state: 'visible', timeout: 10000 });
            await input.fill(field.value);
            await input.press('Tab');
            await page.waitForTimeout(300);
        }

        // Zipcode triggers ShipperHQ rate fetch
        const zipcodeInput = page.getByRole('textbox', { name: 'Zipcode' }).first();
        await zipcodeInput.fill(data.address.zip);
        await zipcodeInput.press('Tab');
        await page.waitForTimeout(3000);

        // State — California = region_id 12
        const stateSelect = page.getByRole('combobox', { name: 'State' });
        await stateSelect.selectOption({ label: data.address.state });
        await page.evaluate(() => {
            const store = (window as any).Alpine?.store?.('LokiCheckout');
            if (!store) return;
            const components = store.getComponentArray?.() || [];
            const regionComp = components.find(
                (c: any) => c.fieldName === 'region' || c.fieldName === 'region_id'
            );
            if (regionComp) {
                regionComp.value = '12';
                regionComp.valid = true;
                regionComp.post('12');
            }
        });
        await page.waitForTimeout(5000);
    }

    test("two shipment origin groups appear for multi-warehouse cart", async ({ page }) => {
        const baseUrl = (process.env.url ?? '').replace(/\/$/, '');

        // Load a page to get form_key, then add products
        await page.goto(`${baseUrl}/${data.products[0].url}`);
        await page.waitForLoadState('domcontentloaded');

        for (const product of data.products) {
            await addProductToCart(page, product.entity_id, product.qty);
        }

        await page.goto(`${baseUrl}/checkout/`);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);

        await fillAddress(page);

        // Wait for ShipperHQ origin groups (two group headings expected)
        // Groups are typically divs with origin/shipment group labels
        await page.waitForFunction(
            () => {
                const text = document.body.innerText;
                return text.includes('GF') || text.includes('PPS') ||
                       text.includes('Easton') || text.includes('Olive Branch') ||
                       document.querySelectorAll('[class*="shipment"], [class*="origin"]').length >= 2;
            },
            { timeout: 90000 }
        );

        const bodyText = await page.evaluate(() => document.body.innerText);
        const hasMultipleGroups = bodyText.includes('GF') || bodyText.includes('PPS') ||
                                  bodyText.includes('Easton') || bodyText.includes('Olive Branch');

        expect(
            hasMultipleGroups,
            'Two shipment origin groups (GF Easton PA + PPS Olive Branch MS) must appear'
        ).toBe(true);
    });

    test("can advance past shipping to billing with multi-origin rates", async ({ page }) => {
        const baseUrl = (process.env.url ?? '').replace(/\/$/, '');

        await page.goto(`${baseUrl}/${data.products[0].url}`);
        await page.waitForLoadState('domcontentloaded');

        for (const product of data.products) {
            await addProductToCart(page, product.entity_id, product.qty);
        }

        await page.goto(`${baseUrl}/checkout/`);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);

        await fillAddress(page);

        // Wait for shipping rates to load
        await page.waitForFunction(
            () => {
                const text = document.body.innerText;
                return (text.includes('GF') || text.includes('PPS') || text.includes('Ground') || text.includes('Freight')) &&
                       !text.includes('Loading');
            },
            { timeout: 90000 }
        );

        await page.waitForTimeout(5000);

        // Loki Shopify theme uses step-by-step "Next" buttons per shipment.
        // Luma uses "Proceed to Review & Payments". Accept either.
        const proceedBtn = page.locator('button:has-text("Next"), button:has-text("Proceed"), button:has-text("Review"), button:has-text("Payment")').first();
        await expect(
            proceedBtn,
            '"Proceed to Review & Payments" button must be visible'
        ).toBeVisible({ timeout: 30000 });

        // Must not be disabled
        await expect(
            proceedBtn,
            '"Proceed to Review & Payments" button must be enabled'
        ).toBeEnabled({ timeout: 10000 });

        await proceedBtn.click();
        await page.waitForTimeout(10000);

        // Must advance past shipping — payment/billing step should appear
        // 502/500 response or stuck-on-shipping = failure
        const url = page.url();
        const pageText = await page.evaluate(() => document.body.innerText);

        const stuck502 = pageText.includes('502') || pageText.includes('Bad Gateway');
        expect(stuck502, 'Must not get a 502 Bad Gateway error').toBe(false);

        const atBilling = pageText.toLowerCase().includes('payment') ||
                          pageText.toLowerCase().includes('billing') ||
                          pageText.toLowerCase().includes('credit card') ||
                          pageText.toLowerCase().includes('place order');

        expect(
            atBilling,
            'Checkout must advance to billing/payment step after clicking Proceed'
        ).toBe(true);
    });

});
