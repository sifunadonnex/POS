import { afterEach, expect, it, vi } from "vitest"
import { getPurchaseReconciliation } from "./reports-api"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it("parses the purchase reconciliation report with net totals", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        from: "2026-09-01",
        to: "2026-09-21",
        summary: {
          receiptCount: 3,
          receivedTotalMinor: 45000,
          returnCount: 1,
          returnedTotalMinor: 5000,
          netPurchasesMinor: 40000,
          supplierCount: 2,
        },
        suppliers: [
          {
            supplierId: "supplier-1",
            supplierName: "Alpha Foods",
            receiptCount: 2,
            receivedTotalMinor: 30000,
            returnCount: 1,
            returnedTotalMinor: 5000,
            netPurchasesMinor: 25000,
            lastReceiptAt: "2026-09-21T08:00:00.000Z",
          },
        ],
        receipts: [
          {
            receiptId: "receipt-1",
            supplierId: "supplier-1",
            supplierName: "Alpha Foods",
            totalMinor: 20000,
            returnedTotalMinor: 5000,
            netTotalMinor: 15000,
            reason: "Delivery note 1042",
            createdAt: "2026-09-21T08:00:00.000Z",
            lineCount: 2,
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  )
  vi.stubGlobal("fetch", fetch)

  await expect(
    getPurchaseReconciliation("2026-09-01", "2026-09-21")
  ).resolves.toMatchObject({
    summary: { netPurchasesMinor: 40000 },
    suppliers: [expect.objectContaining({ netPurchasesMinor: 25000 })],
    receipts: [expect.objectContaining({ netTotalMinor: 15000 })],
  })
  expect(fetch).toHaveBeenCalledWith(
    "/api/reports/purchases?from=2026-09-01&to=2026-09-21",
    expect.objectContaining({ credentials: "same-origin" })
  )
})

it("surfaces a rejected purchase reconciliation report", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Manager access required" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    )
  )

  await expect(
    getPurchaseReconciliation("2026-09-01", "2026-09-21")
  ).rejects.toThrow("Manager access required")
})
