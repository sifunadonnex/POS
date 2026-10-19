# M-Pesa setup

The POS uses the same OAuth → STK prompt → confirmation flow inspected in the user's Sahibu Laravel app. The cashier chooses M-Pesa, enters the customer's phone and sends the prompt; the existing payment-attempt flow handles waiting, confirmation and retries.

## Server settings

Keep credentials in the private backend environment. The required account values are:

```dotenv
DARAJA_ENABLED=false
DARAJA_ENVIRONMENT=production
DARAJA_CONSUMER_KEY=...
DARAJA_CONSUMER_SECRET=...
DARAJA_SHORTCODE=...
DARAJA_PASSKEY=...
# Buy Goods: the receiving Till, separate from the API business shortcode.
DARAJA_TILL_NUMBER=...
```

The user confirmed **Buy Goods Till** on 17 October 2026 and will enter `DARAJA_TILL_NUMBER` privately. Supplying that field selects `CustomerBuyGoodsOnline` automatically. An explicit `DARAJA_TRANSACTION_TYPE=CustomerBuyGoodsOnline` is also supported. For PayBill, omit the Till field or make it match the business shortcode and use `CustomerPayBillOnline`. Buy Goods requires an explicit receiving Till; the application does not guess it.

`BusinessShortCode` and the STK password use `DARAJA_SHORTCODE`. `PartyB` uses the receiving Till. These can differ, as they do in Sahibu's integration.

## Automatic callback setup

On a hosted deployment, the callback defaults to the public HTTPS `BETTER_AUTH_URL` plus:

`/api/payment-attempts/mpesa/callback`

For POP N GO the public base callback is:

`https://pos.sifulabs.co.ke/api/payment-attempts/mpesa/callback`

The user requested this setup, and that URL is now saved as `DARAJA_CALLBACK_URL` in the private local environment. This prepares the hosted callback address; a callback must reach the API/database that initiated the payment. A local-only API cannot receive callbacks sent to an unrelated hosted database.

No manual callback token is required. The backend derives a stable, domain-separated HMAC-SHA256 token from the consumer secret and business shortcode, then adds it to the callback request URL. Existing explicit `DARAJA_CALLBACK_TOKEN` values remain supported for independent rotation. Changing the consumer secret/shortcode also changes the automatic callback token; settle pending requests before rotating, or retain a separately configured token during the rotation. Reverse proxies must preserve the callback query string and redact tokenized URLs from logs.

An explicit `DARAJA_CALLBACK_URL` remains available when the public API origin differs from the application origin. It must be HTTPS without embedded credentials, query parameters or fragments.

## Configuration check

After compiling the backend, run:

```powershell
pnpm run mpesa:check
```

This validates account settings even while M-Pesa is switched off, without printing credentials, connecting to PostgreSQL, contacting Safaricom or sending an STK request. It reports the environment, PayBill/Buy Goods mode, callback source and automatic/explicit token status. It does not prove provider acceptance or public callback reachability.

`DARAJA_ENABLED=true` activates the configured provider. The existing sandbox/authorized live-test verification still applies before actual customer use; the inspection/setup task does not enable production payments or charge a number. The local flag remains false.

## Payment behavior retained

STK acceptance is pending, not paid. The payment commits only after matching the expected checkout reference, exact amount and receipt. Duplicate callbacks/retries cannot add another payment. Customer cancellation/failure permits the documented retry; interrupted/uncertain outcomes remain pending/unknown until reconciled. A status-query success without an exact returned amount does not manufacture a payment confirmation.

Verify the callback, cancellation, timeout, duplicate and wrong-amount cases against the deployed API before live use. Card remains separate and unavailable until integrated. This comparison added no provider SDK, paid service or database migration.

Inspected references: `C:/Users/sifun/Desktop/projects/Sahibu/app/Services/Daraja.php`, `MpesaPayments.php`, `MpesaConnections.php` and the sales STK form. The Sahibu project was read only; no credentials were copied between apps. Official request reference: [Safaricom's SDK](https://github.com/safaricom/mpesa-java-sdk/blob/master/src/main/java/Mpesa.java).
