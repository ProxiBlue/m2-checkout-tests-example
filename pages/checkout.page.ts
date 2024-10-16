import BasePage from "@hyva/pages/base.page";
import type {Page, TestInfo} from "@playwright/test";
import {expect} from "../fixtures";
import * as actions from "@utils/base/web/actions";
import * as locators from "../locators/checkout.locator";
import * as pageLocators from "@hyva/locators/page.locator"
import * as customerForm from "../locators/customer_form.locator";
import { CustomerData } from '@hyva/interfaces/CustomerData';


// dynamically import the test JSON data based on the APP_NAME env variable
// and if the file exixts in APP path, and if not default to teh base data
let data = {};
const fs = require("fs");
let JSONDataFile = '/data/checkout.data.json'
if (fs.existsSync(__dirname + '/../../' + process.env.APP_NAME + JSONDataFile)) {
    import('../../' + process.env.APP_NAME + JSONDataFile).then((dynamicData) => {
        data = dynamicData;
    });
} else {
    import('..' + JSONDataFile).then((dynamicData) => {
        data = dynamicData;
    });
}
export default class CheckoutPage extends BasePage {
    constructor(public page: Page, public workerInfo: TestInfo) {
        super(page, workerInfo, data, locators); // pass the data and locators to teh base page class
    }

    async navigateTo() {
        await actions.navigateTo(this.page, process.env.URL, this.workerInfo);
        const url = this.page.url();
    }

    async clickProceedToCheckout() {
        await this.page.locator(locators.checkout_button).click();
        await this.page.waitForLoadState("domcontentloaded");
        await this.page.waitForSelector(locators.shipping_label);
        expect(this.page.locator(locators.title)).toContainText(data['header_title']);
    }

    async fillCustomerForm(customerData : CustomerData) {
        await this.page.fill(customerForm['email'], customerData.email);
        await this.page.fill(customerForm['firstname'], customerData.firstName);
        await this.page.fill(customerForm['lastname'], customerData.lastName);
        await this.page.fill(customerForm['street_address'], customerData.street_one_line);
        await this.page.fill(customerForm['city'],customerData.city);
        await this.page.locator(customerForm['zip']).pressSequentially(customerData.zip);
        await this.page.fill(customerForm['phone'], customerData.phone);
        await this.page.selectOption(customerForm['state'], customerData.zip);
    }

    async selectShippingMethod() {
        // shipperHQ must be disabled by setting flatrate enabled, setting it as fallback and setting timeout to 0
        await this.page.check('input[name="ko_unique_1"]');
        await this.page.locator(locators.shipping_next_button).click();
    }

    async selectPaymentmethod() {
        await this.page.waitForLoadState("domcontentloaded");
        await this.page.waitForSelector(locators.payment_group);
        await this.page.getByLabel('Check / Money order').check();
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

    async testSuccessPage() {
        await this.page.waitForLoadState("networkidle");
        await this.page.waitForLoadState("domcontentloaded");
        await this.page.waitForSelector(pageLocators.pageTitle);
        expect(this.page.locator(pageLocators.pageTitle)).toHaveText(data['success_page_heading']);
    }

}
