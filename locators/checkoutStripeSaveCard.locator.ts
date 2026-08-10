// Locators for the guest save-card opt-in on Loki Checkout's Stripe Payment Element.
// The save-card toggle is rendered BY STRIPE inside the same secure iframe as the
// card fields (see @checkout/locators/loki_checkout.locator stripe_iframe). It only
// renders when a Stripe Customer Session is attached to `stripe.elements({...})`
// (`customerSessionClientSecret`, minted server-side by
// `GuestCustomerSessionProvider` and injected client-side by
// `EnableSavePaymentMethodPlugin` + the `loki-checkout/magento2-stripe`
// elementParams composer patch) with
// `payment_element.features.payment_method_save: 'enabled'` — `setupFutureUsage`
// alone (the prior, now-superseded approach) is not sufficient to surface this UI.
// Default-CHECKED per Stripe's own Customer Session UX — the guest opts OUT by
// unchecking, not in by checking.
//
// Distinct from the Stripe LINK "save my information for faster checkout" checkbox
// (see loki_checkout.page.ts fillStripePayment(), which explicitly unticks that one) —
// this toggle's accessible name references saving the CARD/PAYMENT METHOD for future
// purchases, not Link enrolment.
export const save_card_toggle = /save.*(payment|card).*(future|next time)/i;
