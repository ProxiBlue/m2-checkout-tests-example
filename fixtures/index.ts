import { test as baseTest } from "@hyva/fixtures";
import checkoutPage from "../pages/checkout.page";


type pages = {
    checkoutPage: checkoutPage;
};

const testPages = baseTest.extend<pages>({
    checkoutPage: async ({ page }, use, workerInfo) => {
        await use(new checkoutPage(page, workerInfo));
    }
});

export const test = testPages;
export const expect = testPages.expect;
export const describe = testPages.describe;
