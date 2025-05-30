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
        if (await this.page.isVisible(customerForm.email)) {
            await this.page.fill(customerForm.email, customerData.email);
        }
        await this.page.fill(customerForm.firstname, customerData.firstName);
        await this.page.fill(customerForm.lastname, customerData.lastName);
        await this.page.fill(customerForm.street_address, customerData.street_one_line);
        await this.page.fill(customerForm.city,customerData.city);
        await this.page.locator(customerForm.zip).pressSequentially(customerData.zip);
        await this.page.fill(customerForm.phone, customerData.phone);
        await this.page.selectOption(customerForm.state, '59');
    }

    async selectShippingMethod() {
        // shipperHQ must be disabled by setting flatrate enabled, setting it as fallback and setting timeout to 0
        await this.page.check('input[value="flatrate_flatrate"]');
        await this.page.locator(locators.shipping_next_button).click();
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
        const elements = await this.page.$$(locators.place_order_button);
        // Filter to find the first visible element
        for (const element of elements) {
            if (await element.isVisible()) {
                await element.click();
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
        await this.page.waitForLoadState("domcontentloaded");
        await this.page.waitForTimeout(5000);
        const successPageHeading = this.data.default.success_page_heading || '';
        expect(this.page.locator(pageLocators.pageTitle)).toHaveText(successPageHeading);
        const orderId = await this.page.locator(locators.success_order_id).first().textContent();
        return orderId ?? "";
    }

}
