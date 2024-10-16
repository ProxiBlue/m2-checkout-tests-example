import { test as hyvaBase } from "@hyva/fixtures";
import CommonPage from "@common/pages/common.page";
import checkoutPage from "../pages/checkout.page";
import SimpleProductPage from "@hyva/pages/simple_product.page"
import { Customer } from "@hyva/fixtures/customer";
import { CustomerData } from '@hyva/interfaces/CustomerData';
import CustomerPage from "@hyva/pages/customer.page";


type pages = {
    commonPage: CommonPage;
    checkoutPage: checkoutPage;
    simpleProductPage: SimpleProductPage;
    customerData: CustomerData;
    customerPage: CustomerPage;
};

const testPages = hyvaBase.extend<pages>({
    commonPage: async ({ page }, use, workerInfo) => {
        await use(new CommonPage(page, workerInfo));
    },
    simpleProductPage: async ({ page }, use, workerInfo) => {
        await use(new SimpleProductPage(page, workerInfo));
    },
    checkoutPage: async ({ page }, use, workerInfo) => {
        await use(new checkoutPage(page, workerInfo));
    },
    customerData: async ({ page }, use) => {
        const customer = new Customer();
        const customerData: CustomerData = customer.getCustomerData();
        await use(customerData);
    },
    customerPage: async ({ page }, use, workerInfo) => {
        await use(new CustomerPage(page, workerInfo));
    }
});

export const test = testPages;
export const expect = testPages.expect;
export const describe = testPages.describe;
