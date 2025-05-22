import BasePage from "@common/pages/base.page";
import {Page, TestInfo, expect, test} from "@playwright/test";
import * as actions from "@utils/base/web/actions";
import * as locators from "../locators/checkout.locator";
import * as pageLocators from "@hyva/locators/page.locator"
import * as customerForm from "../locators/customer_form.locator";
import { CustomerData } from '@common/interfaces/CustomerData';


// dynamically import the test JSON data based on the APP_NAME env variable
// and if the file exixts in APP path, and if not default to teh base data
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

let data: CheckoutData = {"default": {}};
// Load data synchronously to ensure it's available when needed
const fs = require("fs");
try {
    let dataPath;
    let JSONDataFile = '/data/checkout.data.json';
    if (fs.existsSync(__dirname + '/../../' + process.env.APP_NAME + JSONDataFile)) {
        dataPath = __dirname + '/../../' + process.env.APP_NAME + JSONDataFile;
    } else {
        dataPath = __dirname + '/..' + JSONDataFile;
    }
    const jsonData = fs.readFileSync(dataPath, 'utf8');
    let parsedData = JSON.parse(jsonData);
    // Ensure data has a default property
    if (!parsedData.default) {
        data = { default: parsedData };
    } else {
        data = parsedData;
    }
} catch (error) {
    console.error(`Error loading checkout data: ${error}`);
}

export default class CheckoutPage extends BasePage {
    constructor(public page: Page, public workerInfo: TestInfo) {
        super(page, workerInfo, data, locators); // pass the data and locators to teh base page class
    }

    async navigateTo() {
        const url: string = this.data.default.url || '';
        await actions.navigateTo(this.page, process.env.URL + url, this.workerInfo);
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
        let subTotal = await actions.getInnerText(this.page, '.data.table.table-totals .totals.sub .amount .price', this.workerInfo);
        return actions.parsePrice(subTotal);
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
