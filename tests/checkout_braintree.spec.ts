import {test, describe, expect } from "@checkout/fixtures";


describe("Checkout braintree with one Item in cart", () => {

    test.setTimeout(90000); // need a large one as this can take soem time to process. (is there a better way?)

    test.beforeEach(async ({simpleProductPage}, testInfo) => {
        await simpleProductPage.navigateTo();
        await simpleProductPage.addToCart();
    });

    test("it can checkout braintree", async ({cartPage, checkoutPage, customerData, adminPage, adminOrdersPage}) => {
        await cartPage.navigateTo();
        const itemLineTotal = await cartPage.getLineItemsPrices();
        //@ts-ignore
        await cartPage.checkSubtotalMatches(itemLineTotal.toFixed(2));
        await cartPage.clickProceedToCheckout();
        await checkoutPage.fillCustomerForm(customerData)
        await checkoutPage.selectShippingMethod();
        const checkoutSubTotal = await checkoutPage.getSubTotal();
        // test totals matches
        expect(itemLineTotal).toEqual(checkoutSubTotal);
        await checkoutPage.selectPaymentmethodByName('Credit Card');
        // Test snippet for filling the credit card form
        // Locate the iframe where the form resides
        const creditCardFrame = checkoutPage.page.frameLocator('#braintree-hosted-field-number');
        await creditCardFrame.locator('#credit-card-number').fill('4111111111111111');
        await creditCardFrame.locator('#expiration-month-autofill-field').fill('12');
        await creditCardFrame.locator('#expiration-year-autofill-field').fill('2030');
        await creditCardFrame.locator('#cvv-autofill-field').fill('123');
        await checkoutPage.actionPlaceOrder();
        await checkoutPage.page.locator('img[role="img"][name="Loading..."]').waitFor({ state: 'hidden' });
        let orderId = await checkoutPage.testSuccessPage();
        await adminPage.navigateTo();
        await adminPage.login();
        await adminOrdersPage.navigateTo();
        await adminOrdersPage.checkIfOrderExistsByIncrementId(orderId);
    });


});
