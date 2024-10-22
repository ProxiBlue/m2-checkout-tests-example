import {test, describe, expect } from "../fixtures";

describe("Checkout actions with one Item in cart", () => {

    test.setTimeout(90000);

    test.beforeEach(async ({simpleProductPage}, testInfo) => {
        await simpleProductPage.navigateTo();
        await simpleProductPage.addToCart();
    });

    test("it can proceed to checkout from cart page", async ({cartPage, checkoutPage, customerData, page}) => {
        await cartPage.navigateTo();
        const itemLineTotal = await cartPage.getLineItemsPrices();
        await cartPage.checkSubtotalMatches(itemLineTotal.toFixed(2));
        await cartPage.clickProceedToCheckout();
        await checkoutPage.fillCustomerForm(customerData)
        await checkoutPage.selectShippingMethod();
        const checkoutSubTotal = await checkoutPage.getSubTotal();
        // test totals matches
        expect(itemLineTotal).toEqual(checkoutSubTotal);
        await checkoutPage.selectPaymentmethod();
        await checkoutPage.actionPlaceOrder();
        await checkoutPage.testSuccessPage();
    });


});
