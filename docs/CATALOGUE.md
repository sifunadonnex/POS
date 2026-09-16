# Product catalogue

**Implemented and locally database-verified, 16 September 2026.** The PostgreSQL migration, isolated integration suite, HTTP tests and frontend tests pass. Full interactive browser inspection is still pending. This feature does not implement stock or checkout.

## Use the catalogue

After the database and login setup in [local auth setup](LOCAL_AUTH_SETUP.md) are verified, the staff workspace opens on **Catalogue**.

- All authenticated staff can search active products by name, SKU or barcode. A scanner can enter a barcode into the search field and submit with Enter.
- Managers who completed MFA can create/edit products, archive/reactivate them, maintain categories, review product history and import CSV files.
- Every write requires a reason. Product/category edits carry the loaded revision; stale edits are rejected with a reload message.
- An interrupted save offers **Retry same save**, retaining the original payload/request ID while editing is locked. The backend returns the saved result if that request already committed. If you leave the form, reload and inspect the catalogue before submitting a fresh change.

## Units and exact values

The user confirmed these units and quantity precision on 16 September 2026:

| Unit | Price basis | Quantity step for stock/checkout |
| --- | --- | --- |
| `each` | Per item | 1 whole item |
| `pack` | Per pack | 1 whole pack |
| `kg` | Per kilogram | 0.001 kg (1 gram) |
| `l` | Per litre | 0.001 l (1 millilitre) |

The unit is fixed after creation. A different unit requires a separate product. Packs have no automatic conversion into individual items. This release records the unit and displays its step; quantity entry and sale-total calculation arrive with stock/checkout.

Prices are KES decimal strings on input and integer minor-unit strings on output. The server converts using integer arithmetic; `180.05` becomes `18005`, and `0.01` becomes `1`. Prices from `0.00` to `9,999,999.99` are accepted. Fractions of a cent, scientific notation, commas, negative values and floating-point JSON numbers are rejected. Future checkout must define and test fractional-quantity line rounding before finalizing sales.

## Product and category rules

- SKU: required, at most 40 characters, normalized to uppercase. Letters, digits, `.`, `_` and `-` are accepted. Unique across active and archived products.
- Product name: required, at most 160 characters. Category is optional; category names are unique ignoring case, up to 80 characters. Up to 1,000 categories are supported.
- Up to five distinct barcodes per product. Codes are text, case-sensitive, at most 64 characters; leading zeros are retained. Codes must be unique across products, including archived products.
- Tax classification code: optional, at most 40 characters. This is metadata only; no tax rate, KRA mapping or fiscal calculation is inferred or implemented.
- Archiving hides a product from cashier searches and exact barcode lookup; managers can filter archived/all products. History remains available. There is no product-delete endpoint.
- Product history stores the full product/price snapshot, revision, authenticated actor, reason and timestamp. Category renaming has its own audit history and does not rewrite earlier product snapshots. Database triggers reject history UPDATE/DELETE; a privileged database administrator can still bypass database controls.

## CSV preview and import

Use **Import CSV → Download sample CSV**. The file must be UTF-8, at most 32 KB and contain at most 100 products. Required columns in this order:

```csv
sku,name,category,unit,price,barcodes,tax_code
RICE-LOOSE,Loose rice,,kg,180.00,0012345678905,
OIL-LOOSE,Cooking oil,,l,250.00,,
SOAP-PACK,Soap pack,,pack,120.00,,
```

Categories must already exist (matching ignores case), or leave them blank. Separate multiple barcodes with `|`. Keep barcode cells formatted as text in spreadsheet software so leading zeros survive export. Quoted commas and doubled quotes are supported. Product fields cannot contain embedded control characters.

Preview shows row-level validation errors and existing SKU/barcode conflicts. Import only creates new active products; it never silently updates existing products or changes stock. The server revalidates the submitted CSV at import time and commits all products/history/request receipt in one transaction. A conflict or invalid row rolls back the entire batch. Preview does not reserve SKUs or barcodes.

## Backend and migration

`backend/src/catalogue/` owns validation, controllers, queries, write transactions, CSV parsing and import. `frontend/src/features/catalogue/` owns the matching UI/API client. The workspace navigation is separate from the login/MFA screen.

`202609160001_catalogue.sql` adds category, product, barcode, append-only history and request-receipt tables. It contains no seed products and does not modify existing identity records. The down migration permanently removes catalogue/history/receipts and is only for deliberate disposable-test rollback.

Reads reuse the global staff guard. Writes require manager role/MFA and the exact trusted Origin; transactions recheck the current user/session while holding database locks. The request receipt binds a UUID to the actor and normalized payload fingerprint. Reuse with different content is rejected. Unique constraints and row revisions protect conflicts in addition to the request lock.

Endpoints under `/api/catalogue`:

| Method/path | Access |
| --- | --- |
| GET `categories`, `products`, `products/by-barcode?code=...` | Authenticated staff; cashier products restricted to active |
| GET `products/:id/history` | Manager with MFA |
| POST `products`, `categories` | Manager with MFA |
| PATCH `products/:id`, `categories/:id` | Manager with MFA |
| POST `imports/preview`, `imports` | Manager with MFA |

Product/history queries return at most 50 rows plus a `hasMore` flag. Product search supports `search`, `categoryId`, `status` and zero-based `page`. Writes include `requestId` and `reason`; updates also include `revision`.

## Verification still required

The development migration and isolated `_test` integration suite have run successfully. `backend/test/catalogue.integration-spec.ts` covers concurrent replay, conflicting barcode rollback, price history, stale edits, import replay/atomicity, archival and transactional MFA checks.

Still verify real manager/cashier browser flows, phone/desktop light/dark layouts, keyboard scanning, CSV file selection, failed saves/retry after reconnect and simultaneous edits. Measure representative catalogue search/import performance. Local database success does not establish visual, hosted, load or checkout readiness.

Next feature: stock opening/receiving/adjustments with append-only movements and exact whole/fractional quantities, before connecting catalogue prices and stock to cash checkout.
