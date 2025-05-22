import { test as baseTest } from "@common/fixtures";
import SimpleProductPage from "@hyva/pages/simple_product.page";
import checkoutPage from "@checkout/pages/checkout.page";
import CartPage from "@hyva/pages/cart.page";
import AdminPage from '@admin/pages/admin.page';
import AdminOrdersPage from "@admin/pages/orders.page";
import CustomerPage from "@hyva/pages/customer.page";

type pages = {
    checkoutPage: checkoutPage;
    simpleProductPage: SimpleProductPage;
    cartPage: CartPage;
    adminPage: AdminPage;
    adminOrdersPage: AdminOrdersPage;
    customerPage: CustomerPage;
};

const testPages = baseTest.extend<pages>({
    checkoutPage: async ({ page }, use, workerInfo) => {
        await use(new checkoutPage(page, workerInfo));
    },
    simpleProductPage: async ({ page }, use, workerInfo) => {
        await use(new SimpleProductPage(page, workerInfo));
    },
    cartPage: async ({ page }, use, workerInfo) => {
        await use(new CartPage(page, workerInfo));
    },
    adminPage: async ({ page }, use, workerInfo) => {
        await use(new AdminPage(page, workerInfo));
    },
    adminOrdersPage: async ({ page }, use, workerInfo) => {
        await use(new AdminOrdersPage(page, workerInfo));
    },
    customerPage: async ({ page }, use, workerInfo) => {
        await use(new CustomerPage(page, workerInfo));
    },
});

export const test = testPages;
export const expect = testPages.expect;
export const describe = testPages.describe;
