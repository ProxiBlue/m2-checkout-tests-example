import { test as baseTest } from "@common/fixtures";
import SimpleProductPage from "@hyva/pages/simple_product.page";
import checkoutPage from "@checkout/pages/checkout.page";
import LokiCheckoutPage from "@checkout/pages/loki_checkout.page";
import CheckoutStripeSaveCardPage from "@checkout/pages/checkoutStripeSaveCard.page";
import CartPage from "@hyva/pages/cart.page";
import AdminPage from '@admin/pages/admin.page';
import AdminOrdersPage from "@admin/pages/orders.page";
import AdminCustomerPage from "@admin/pages/customer.page";
import CustomerPage from "@hyva/pages/customer.page";

type pages = {
    checkoutPage: checkoutPage;
    lokiCheckoutPage: LokiCheckoutPage;
    checkoutStripeSaveCardPage: CheckoutStripeSaveCardPage;
    simpleProductPage: SimpleProductPage;
    cartPage: CartPage;
    adminPage: AdminPage;
    adminOrdersPage: AdminOrdersPage;
    adminCustomerPage: AdminCustomerPage;
    customerPage: CustomerPage;
};

const testPages = baseTest.extend<pages>({
    checkoutPage: async ({ page }, use, workerInfo) => {
        await use(new checkoutPage(page, workerInfo));
    },
    lokiCheckoutPage: async ({ page }, use, workerInfo) => {
        await use(new LokiCheckoutPage(page, workerInfo));
    },
    checkoutStripeSaveCardPage: async ({ page }, use, workerInfo) => {
        await use(new CheckoutStripeSaveCardPage(page, workerInfo));
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
    adminCustomerPage: async ({ page }, use, workerInfo) => {
        await use(new AdminCustomerPage(page, workerInfo));
    },
    customerPage: async ({ page }, use, workerInfo) => {
        await use(new CustomerPage(page, workerInfo));
    },
});

export const test = testPages;
export const expect = testPages.expect;
export const describe = testPages.describe;
