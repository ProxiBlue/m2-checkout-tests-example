// Loki Checkout locators (Alpine.js-based single-page checkout)
// Email: use the stable Loki block-derived id (IdConvertor on
// loki-checkout.customer.customer.email). The old attribute-based selector
// (aria-label / placeholder*=email) now ALSO matches a hidden pps-theme
// contact-widget input (class email_data) that precedes Loki's field in DOM
// order since /checkout/ moved onto the Uptactics/pps theme — .first() then
// resolves to the hidden input and toBeVisible() fails.
export const email_field = '#loki-checkout-customer-customer-email-field, input[name="customer_email"]';
export const signup_checkbox = 'input[type="checkbox"][id*="checkout-signup"]';
export const billing_same_checkbox = 'input[type="checkbox"][id*="shipping-as-billing"]';
export const shipping_radio = 'input[type="radio"][name*="shipping"]';
export const stripe_radio = 'input[type="radio"][value="stripe_payments"]';
export const stripe_iframe = 'iframe[title="Secure payment input frame"]';
export const stripe_card_number = '[name="number"], input[placeholder*="card number" i], #Field-numberInput';
export const stripe_expiry = '[name="expiry"], input[placeholder*="MM" i], #Field-expiryInput';
export const stripe_cvc = '[name="cvc"], input[placeholder*="CVC" i], #Field-cvcInput';
export const pay_now_button = 'button:has-text("PAY NOW"), button:has-text("Pay Now")';
export const success_heading = 'h1';
export const success_container = '.checkout-success';

// Tax-exempt locators (Loki phtml / Alpine.js rendered DOM)
// Block name: loki-checkout.tax-exempt-checkbox → element id: loki-checkout-tax-exempt-checkbox-field
export const tax_exempt_checkbox = 'input[id="loki-checkout-tax-exempt-checkbox-field"], input[id*="tax-exempt-checkbox"], input[type="checkbox"][id*="tax-exempt-requested"]';
export const tax_exempt_warning_note = '.loki-tax-exempt-warning, [x-show="value"][x-cloak]';
// Sidebar totals use data-code attribute per loki-checkout/magento2-core totals.phtml
export const sidebar_tax_value = 'dd[data-code="tax"], [data-test-id="sidebar-tax-value"], .totals-tax .price, .totals-tax-summary .price';
// Root element of the tax-exempt component — present only when isAllowRendering() returns true.
// Loki's AddHtmlAttributesToComponentBlock observer injects x-data on the first tag; the
// not-rendered placeholder has no x-data attribute, so count === 0 means server gated it out.
export const tax_exempt_block_root = '[x-data="LokiCheckoutTaxExemptCheckbox"]';

// PAY NOW / accept-default spec locators (GH #390)
// Stable PAY NOW button id — derived from block name 'loki-checkout.steps.billing.forward-button'
// via IdConvertor::toElementId() (lowercased, non-alphanumeric → '-').
// This is locale-stable; do NOT use text-based selectors — button_label is translate="true".
export const pay_now_button_stable = '#loki-checkout-steps-billing-forward-button, [x-data="LokiCheckoutStepForwardButton"]';
// Error toast surfaced by the steps.phtml intercept patch or by the EnsurePaymentMethodPlugin
export const error_toast_message = '[x-data*="Message"] [class*="error"], .message-error, [role="alert"][class*="error"]';
// Alpine message store — the text container inside the global message block
export const alpine_error_text = '[x-data*="Message"] [class*="error"] span, [x-data*="Message"] [class*="error"] p, [x-data*="Message"] [class*="error"]';
// Loki checkout steps root — used to detect form-wipe (empty steps = bug fired)
export const loki_steps_root = '#loki-checkout-steps';
// Payment method radio (check/money order)
export const checkmo_radio = 'input[type="radio"][value="checkmo"]';
// Order success container
export const order_success_container = '.checkout-success, [class*="checkout-success"]';
// Order increment ID on success page
export const order_increment_id = '.checkout-success .order-number, .checkout-success strong, .checkout-success [class*="order"]';

// Login-at-checkout locators (GH #361 / login-cart-token-refresh)
// Password input that appears after email recognition detects existing account.
// The unique id is derived from the block name loki-checkout.customer.customer.email
// via IdConvertor::toElementId (lowercased, dots → dashes). `input[name="password"]`
// is not viable — the Luma authentication-popup (hidden) also carries name=password
// which trips Playwright strict-mode. `input[type="password"]` is also fragile
// because Loki binds :type reactively via passwordFieldType.
export const login_password_field = '#loki-checkout-customer-customer-email-password';
// Sign In button rendered by customer/login.phtml inside Loki checkout steps
export const sign_in_button = 'button:has-text("Sign In"), button[id*="-button"]:has-text("Sign In")';
// Shipping methods area — container rendered after address fill triggers estimation
export const shipping_methods_area = 'input[type="radio"][name*="shipping"]';

// Pay Now guard overlay + silent-error toast (GH #419 / task 003)
// Wrapper x-data anchor from pay-now-overlay-guard.phtml — always in the DOM
// (before.body.end, sibling of #loki-checkout — see task 002 notes); the inner
// `[aria-busy]` div is the vendor loki-field-components loader-overlay itself,
// x-show="showLoader" (:aria-busy mirrors the same getter) — assert visibility
// on this inner element, not the always-present wrapper.
export const pay_now_overlay_anchor = '#uptactics-pay-now-overlay';
export const pay_now_overlay_loader = '#uptactics-pay-now-overlay [aria-busy]';
// Toast from pay-now-error-toast.phtml — x-show/x-text live on the same
// element (no separate inner node), listens for `loki-checkout.error.silent`.
export const pay_now_error_toast = '#uptactics-pay-now-toast';
