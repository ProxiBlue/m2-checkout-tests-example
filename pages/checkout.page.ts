import BasePage from "@common/pages/base.page";
import {Page, TestInfo, expect, test} from "@playwright/test";
import * as locators from "../locators/checkout.locator";
import * as pageLocators from "@hyva/locators/page.locator"
import * as customerForm from "../locators/customer_form.locator";
import { CustomerData } from '@common/interfaces/CustomerData';
import { loadJsonData } from "@utils/functions/file";
import { parsePrice } from "@utils/functions/price";

// Define the CheckoutData interface
interface CheckoutData {
    default: {
        url?: string;
        header_title?: string;
        page_title_text?: string;
        subtotal_label?: string;
        grandtotal_label?: string;
        success_page_heading?: string;
    };
}

// Default checkout data structure
const defaultData: CheckoutData = {"default": {}};

// Load the checkout data using the utility function
let data = loadJsonData<CheckoutData>('checkout.data.json', 'checkout', defaultData);

// Ensure data has a default property
if (data && !data.default) {
    data = { default: data as any };
}

export default class CheckoutPage extends BasePage {
    constructor(public page: Page, public workerInfo: TestInfo) {
        super(page, workerInfo, data, locators); // pass the data and locators to teh base page class
    }

    async navigateTo() {
        const url: string = this.data.default.url || '';
        await test.step(
            this.workerInfo.project.name + ": Go to " + process.env.url + url,
            async () => await this.page.goto(process.env.url + url)
        );
        await this.page.waitForLoadState('domcontentloaded');
    }

    async fillCustomerForm(customerData : CustomerData) {
        await this.page.waitForSelector(locators.shipping_label);
        await this.page.fill(customerForm.firstname, customerData.firstName);
        await this.page.fill(customerForm.lastname, customerData.lastName);
        await this.page.fill(customerForm.street_address, customerData.street_one_line);
        // Use consistent Vermont address so ShipperHQ can resolve shipping rates
        await this.page.fill(customerForm.city, 'Burlington');
        await this.page.locator(customerForm.zip).pressSequentially('05401');
        await this.page.fill(customerForm.phone, customerData.phone);
        await this.page.selectOption(customerForm.state, '59');
    }

    async selectShippingMethod() {
        await this.page.waitForSelector(locators.shipping_label);
        await this.page.waitForTimeout(5000);

        const shippingRadio = this.page.locator('input[type="radio"][value]').first();
        if (await shippingRadio.isVisible({ timeout: 10000 }).catch(() => false)) {
            if (!(await shippingRadio.isChecked())) {
                await shippingRadio.check();
            }
        }

        await this.page.locator(locators.shipping_next_button).click();
        await this.page.waitForURL(/.*#payment/, { timeout: 30000 });
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await this.page.waitForSelector(locators.payment_group, { timeout: 30000 });
    }

    async selectPaymentmethodByName(method : string) {
        await this.page.waitForLoadState("domcontentloaded");
        await this.page.waitForTimeout(5000);
        await this.page.waitForSelector(locators.payment_group);
        await this.page.getByLabel(method, { exact: true }).check();
    }

    async actionPlaceOrder() {
        await this.page.waitForLoadState("domcontentloaded");
        await this.page.waitForSelector(locators.payment_group);

        // Wait for any loading mask to clear before clicking — KO/checkout async ops
        await this.page.locator('.loading-mask').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});

        // Ensure shipping method is still set on the quote — signup-checkbox toggles
        // or other quote updates can wipe the shipping selection between selectShippingMethod
        // and place order (webkit is particularly prone to this).
        const hasShipping = await this.page.evaluate(() => {
            try {
                const quote = (window as any).require('Magento_Checkout/js/model/quote');
                const m = quote.shippingMethod();
                return !!(m && (m.method_code || m.carrier_code));
            } catch { return false; }
        });

        if (!hasShipping) {
            await this.page.evaluate(() => {
                const require = (window as any).require;
                const selectMethod = require('Magento_Checkout/js/action/select-shipping-method');
                const rates = require('Magento_Checkout/js/model/shipping-service').getShippingRates()();
                if (rates.length > 0) selectMethod(rates[0]);
            });
            await this.page.waitForTimeout(2000);
        }

        const elements = await this.page.$$(locators.place_order_button);
        for (const element of elements) {
            if (await element.isVisible() && await element.isEnabled()) {
                await element.scrollIntoViewIfNeeded();
                await element.click({ force: true });
                break;
            }
        }
    }

    async getSubTotal() {
        let subTotal = await test.step(
            this.workerInfo.project.name + ": Get innertext from .data.table.table-totals .totals.sub .amount .price",
            async () => await this.page.innerText('.data.table.table-totals .totals.sub .amount .price')
        );
        return parsePrice(subTotal);
    }

    async testSuccessPage() : Promise<string> {
        // Wait for navigation to success URL first (cold cache can take 60s+ for order placement)
        await this.page.waitForURL(/\/checkout\/onepage\/success/, { timeout: 90000 });
        await this.page.waitForLoadState("domcontentloaded");
        await this.page.waitForSelector('.checkout-success', { timeout: 30000 });
        const successPageHeading = this.data.default.success_page_heading || '';
        await expect(this.page.locator(pageLocators.pageTitle)).toHaveText(successPageHeading);
        const orderId = await this.page.locator(locators.success_order_id).first().textContent();

        return orderId ?? "";
    }

}
