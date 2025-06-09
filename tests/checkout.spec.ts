import {test, describe, expect } from "../fixtures";
import * as customerForm from "@checkout/locators/customer_form.locator";

describe("Checkout actions with one Item in cart", () => {

    test.setTimeout(90000);

    test.beforeEach(async ({simpleProductPage}, testInfo) => {
        await simpleProductPage.navigateTo();
        await simpleProductPage.addToCart();
    });

    test("it can proceed to checkout from cart page", async ({cartPage, checkoutPage, customerData, page}) => {
        await cartPage.navigateTo();
        const itemLineTotal = await cartPage.getLineItemsPrices();
        //@ts-ignore
        await cartPage.checkSubtotalMatches(itemLineTotal.toFixed(2));
        await cartPage.clickProceedToCheckout();
        await checkoutPage.page.waitForLoadState("domcontentloaded");
        await checkoutPage.page.fill(customerForm.email, customerData.email);
        await checkoutPage.page.waitForLoadState("domcontentloaded");
        await checkoutPage.fillCustomerForm(customerData)
        await checkoutPage.selectShippingMethod();
        const checkoutSubTotal = await checkoutPage.getSubTotal();
        // test totals matches
        expect(itemLineTotal).toEqual(checkoutSubTotal);
        await checkoutPage.selectPaymentmethodByName('Check / Money order');
        await checkoutPage.actionPlaceOrder();
        await checkoutPage.testSuccessPage();
    });


});
