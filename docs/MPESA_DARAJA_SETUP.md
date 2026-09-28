# Safaricom Daraja M-Pesa Express setup

The M-Pesa Express integration is implemented but disabled. Keep it disabled until the sandbox credentials and callback path below are verified. Never paste live credentials into chat, tracked files, browser variables or screenshots; put them only in the ignored `backend/.env` file or the host's private server environment.

## Values to obtain

From the Safaricom Daraja portal and the shop's M-Pesa arrangement, obtain:

- the app Consumer Key and Consumer Secret;
- the business shortcode (PayBill or Till);
- the Lipa na M-Pesa Online passkey for that shortcode;
- whether the shortcode uses `CustomerPayBillOnline` or `CustomerBuyGoodsOnline`; and
- sandbox test credentials first, with production credentials treated as a separate go-live step.

The backend also needs a public HTTPS base URL. Its callback must resolve to:

`https://YOUR_API_HOST/api/payment-attempts/mpesa/callback`

The reverse proxy must preserve the query string. The application adds its secret callback token as a query parameter when it sends the STK Push request.

## Private backend configuration

Copy the Daraja names from `backend/env.example` into the ignored `backend/.env` file and set:

```dotenv
DARAJA_ENABLED=false
DARAJA_ENVIRONMENT=sandbox
DARAJA_CONSUMER_KEY=...
DARAJA_CONSUMER_SECRET=...
DARAJA_SHORTCODE=...
DARAJA_PASSKEY=...
DARAJA_TRANSACTION_TYPE=CustomerPayBillOnline
DARAJA_CALLBACK_URL=https://YOUR_API_HOST/api/payment-attempts/mpesa/callback
DARAJA_CALLBACK_TOKEN=...
```

Generate a unique unpredictable callback token with at least 32 characters. Do not reuse the consumer secret or passkey. Keep `DARAJA_ENABLED=false` while assembling the values; startup validates the complete configuration when it is changed to `true`.

Use `CustomerPayBillOnline` for a PayBill and `CustomerBuyGoodsOnline` for a Till only when that matches the credentials issued by Safaricom. No Daraja secret belongs in a `VITE_*` frontend variable.

## Sandbox verification gate

After the public callback is reachable and the sandbox values are installed, enable the adapter and verify all of these with test data:

1. The register reports M-Pesa available while Card remains unavailable.
2. A valid `07...`, `01...` or `254...` number receives an STK prompt for the exact whole-KES sale total.
3. A successful callback contains the expected checkout reference, receipt and exact amount; only then does the receipt become available.
4. Customer cancellation and provider failure leave no paid sale record and allow the documented retry flow.
5. Timeout, delayed callback and status-query uncertainty remain pending/unknown and do not permit a second charge.
6. Duplicate callbacks do not create a duplicate provider event or sale payment.
7. Wrong amount, wrong reference, missing receipt, malformed payload and wrong callback token never confirm payment.
8. The callback remains reachable through the actual reverse proxy and its logs do not expose credentials, customer phone numbers or the full tokenized callback URL.

The current status query is intentionally conservative: a provider result code of success without an exact returned amount does not prove that this sale received the correct value. It stays unknown rather than manufacturing confirmation.

## Production gate

Production is a separate decision. Before changing `DARAJA_ENVIRONMENT=production`, issue production credentials, rotate the callback token, confirm the correct shortcode/transaction type, repeat the sandbox cases against the approved production test procedure, document provider fees and support/reversal operations, and complete hosted TLS, backup and monitoring checks. Enabling the adapter authorizes real STK requests, so do not use production customer numbers for ordinary development.

Official references: [Daraja APIs](https://developer.safaricom.co.ke/apis), [Authorization API](https://developer.safaricom.co.ke/apis/Authorization), [Transaction Status API](https://developer.safaricom.co.ke/apis/TransactionStatus), and Safaricom's [M-Pesa Node library examples](https://github.com/safaricom/mpesa-node-library).
