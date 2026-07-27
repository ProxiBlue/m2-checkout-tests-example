import { test, describe, expect } from "../fixtures";

// Minimal but valid PDF byte sequence — enough to pass the mime sniff (application/pdf)
// in the controller (\finfo + MIME-type whitelist).
const PDF_BYTES = Buffer.from(
    "%PDF-1.4\n" +
        "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
        "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
        "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n" +
        "xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000053 00000 n\n0000000098 00000 n\n" +
        "trailer<</Size 4/Root 1 0 R>>\nstartxref\n149\n%%EOF\n",
    "utf-8",
);

// NOTE 2026-07-25: the end-to-end "upload cert attached to held order" test was
// REMOVED — it placed its seed order through the legacy Hyva/Magewire checkout
// DOM, which no longer exists (Loki checkout is the only storefront checkout).
// The Loki tax-exempt flow itself is covered by the tax-exempt-loki-*.spec.ts
// suite. Re-adding end-to-end cert-upload coverage = port the order-place step
// to the Loki flow (pattern: tax-exempt-loki-guest-checkout.spec.ts); the
// removed test body is in git history for the assertion checklist (dropdown
// preselect via ?order_increment=, pending status, order linkage, byte-level
// download round-trip).
describe("Tax Exempt Certificate Upload", () => {

    test.setTimeout(300000);

    test.beforeEach(async ({ simpleProductPage }) => {
        await simpleProductPage.navigateTo();
        await simpleProductPage.addToCart();
    });

    // @story: cert-upload-rejected-without-order
    test("upload without an order_id is rejected by the controller", async ({
        customerPage, customerData, page, browserName,
    }) => {
        test.skip(browserName === 'webkit', 'WebKit not exercised');

        const baseUrl = (process.env.url ?? '').replace(/\/$/, '');

        // Register and log in (Magento auto-logs in after register).
        await customerPage.createAccount(customerData);

        // Grab a form_key via the cookie-warming visit. Easier: just hit the certs page first.
        await page.goto(`${baseUrl}/taxexemption/certificates/`);
        await page.waitForLoadState('domcontentloaded');

        // POST without order_id. The controller must reject with success=false and a
        // user-facing message explaining that an order is required.
        const formKey = await page.evaluate(() => {
            // Hyva exposes the form key via window.hyva.getFormKey()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            return w.hyva?.getFormKey?.() || '';
        });
        expect(formKey, 'form_key must be present in the storefront session').toBeTruthy();

        const resp = await page.request.post(`${baseUrl}/taxexemption/certificates/upload/`, {
            multipart: {
                form_key: formKey,
                certificate_file: {
                    name: 'sneaky.pdf',
                    mimeType: 'application/pdf',
                    buffer: PDF_BYTES,
                },
            },
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });
        expect(resp.ok(), `upload endpoint must return 2xx, got ${resp.status()}`).toBeTruthy();

        const data = await resp.json();
        expect(data.success, 'upload without order_id must be rejected').toBeFalsy();
        expect(typeof data.message).toBe('string');
        expect(data.message.toLowerCase()).toContain('order');
    });
});
