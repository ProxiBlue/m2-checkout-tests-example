import { test, describe, expect } from "../fixtures";
import { createCustomerData } from "@common/fixtures/customer";
import * as lokiLocators from "@checkout/locators/loki_checkout.locator";
import { loadJsonData } from "@utils/functions/file";

interface LokiTaxExemptData {
    company_name: string;
    vermont_address: {
        state_id: number;
        state_code: string;
        state_label: string;
        zip: string;
        city: string;
    };
    group_ids: {
        general: number;
        tax_exempt: number;
        need_tax_cert: number;
    };
}

const lokiData = loadJsonData<LokiTaxExemptData>(
    'tax-exempt-loki.data.json',
    'checkout',
    {
        company_name: 'Loki Test Corp',
        vermont_address: { state_id: 59, state_code: 'VT', state_label: 'Vermont', zip: '05401', city: 'Burlington' },
        group_ids: { general: 1, tax_exempt: 9, need_tax_cert: 10 },
    },
);

describe("Tax Exempt Loki — server-side visibility gate for logged-in customers", () => {

    test.setTimeout(300000);

    test.beforeEach(async ({ simpleProductPage }) => {
        await simpleProductPage.navigateTo();
        await simpleProductPage.addToCart();
    });

    test("it does not render the tax-exempt block when a tax-exempt-group customer is logged in", async ({
        lokiCheckoutPage, customerPage, adminPage, adminCustomerPage, customerData, page,
    }, testInfo) => {
        test.skip(testInfo.project.name.includes('webkit'), 'Webkit — covered by chromium');

        // 1. Create customer and move to Tax Exempt group (9) via admin
        await customerPage.createAccount(customerData);
        await adminPage.navigateTo();
        await adminPage.login();
        await adminCustomerPage.setCustomerGroupByEmail(customerData.email, lokiData.group_ids.tax_exempt);

        // 2. Log in as tax-exempt-group customer
        await customerPage.login(customerData);

        // 3. Navigate to Loki checkout
        await lokiCheckoutPage.navigateTo();

        // 4. Assert the tax-exempt block root element is NOT in the DOM
        // toHaveCount(0) distinguishes "never rendered" from "x-cloak hidden"
        const blockRoot = page.locator(lokiLocators.tax_exempt_block_root);
        await expect(blockRoot).toHaveCount(0, { timeout: 10000 });

        await testInfo.attach('loki-exempt-group-block-absent', {
            body: await page.screenshot({ fullPage: true }),
            contentType: 'image/png',
        });
    });

    test("it renders the tax-exempt block when a non-exempt customer with a company name is logged in", async ({
        lokiCheckoutPage, customerPage, page,
    }, testInfo) => {
        test.skip(testInfo.project.name.includes('webkit'), 'Webkit — covered by chromium');

        // 1. Create a retail customer (stays in General group — no admin group change needed)
        const retailCustomer = await createCustomerData(process.env.faker_locale);
        await customerPage.createAccount(retailCustomer);

        // 2. After createAccount the customer is auto-logged in; login() ensures session is active
        await customerPage.login(retailCustomer);

        // 3. Navigate to Loki checkout (product added by beforeEach)
        await lokiCheckoutPage.navigateTo();

        // 4. Fill address with company name — POM method uses autocomplete="organization"
        //    selector and dispatches input+change events so Alpine's store picks up the value
        await lokiCheckoutPage.fillDeliveryAddressWithCompany(
            retailCustomer,
            lokiData.company_name,
            lokiData.vermont_address.city,
            lokiData.vermont_address.zip,
            lokiData.vermont_address.state_label,
        );

        // 5. Assert the tax-exempt block root IS in the DOM
        // toHaveCount(1) proves the server-side gate (isAllowRendering) returned true
        const blockRoot = page.locator(lokiLocators.tax_exempt_block_root);
        await expect(blockRoot).toHaveCount(1, { timeout: 10000 });

        await testInfo.attach('loki-retail-with-company-block-visible', {
            body: await page.screenshot({ fullPage: true }),
            contentType: 'image/png',
        });
    });

});
