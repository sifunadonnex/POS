import { afterEach, expect, it, vi } from "vitest"
import {
  getDailySummary,
  getPurchaseReconciliation,
  getSalesInsights,
} from "./reports-api"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it("parses product-specific low-stock alerts in the daily summary", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          day: "2026-10-01",
          saleCount: 0,
          salesTotalMinor: 0,
          paymentCount: 0,
          cashMinor: 0,
          cardMinor: 0,
          mpesaMinor: 0,
          refundCount: 0,
          refundMinor: 0,
          closedShiftCount: 0,
          varianceMinor: 0,
          lowStockCount: 1,
          lowStockItems: [
            {
              productId: "product-1",
              sku: "RICE",
              name: "Loose rice",
              unit: "kg",
              quantityMinor: 1250,
              thresholdMinor: 2000,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    )
  )

  await expect(getDailySummary("2026-10-01")).resolves.toMatchObject({
    lowStockCount: 1,
    lowStockItems: [
      expect.objectContaining({ name: "Loose rice", thresholdMinor: 2000 }),
    ],
  })
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

it("parses sales trends, cashier performance and product metrics", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        from: "2026-09-27",
        to: "2026-09-28",
        days: 2,
        scope: {
          source: "all",
          storeId: null,
          label: "All sales sources",
        },
        availableSources: [
          { source: "all", storeId: null, label: "All sales sources" },
          {
            source: "operational",
            storeId: null,
            label: "Hosted operations",
          },
        ],
        reportingLag: {
          status: "current",
          pendingEvents: 0,
          receivedEvents: 2,
          projectedEvents: 2,
          latestReceivedAt: "2026-09-28T08:00:00.000Z",
        },
        coverage: { synchronizedReturns: "not_available" },
        summary: {
          saleCount: 4,
          grossSalesMinor: 26000,
          refundCount: 1,
          refundMinor: 2000,
          netSalesMinor: 24000,
          averageBasketMinor: 6500,
          activeCashierCount: 2,
        },
        daily: [
          {
            day: "2026-09-27",
            saleCount: 1,
            grossSalesMinor: 6000,
            refundMinor: 0,
            netSalesMinor: 6000,
          },
          {
            day: "2026-09-28",
            saleCount: 3,
            grossSalesMinor: 20000,
            refundMinor: 2000,
            netSalesMinor: 18000,
          },
        ],
        cashiers: [
          {
            cashierId: "cashier-1",
            cashierName: "Amina Cashier",
            source: "operational",
            storeId: null,
            saleCount: 3,
            grossSalesMinor: 20000,
            refundMinor: 2000,
            netSalesMinor: 18000,
            averageBasketMinor: 6667,
          },
        ],
        paymentMix: [
          { kind: "cash", paymentCount: 3, amountMinor: 18000 },
          { kind: "mpesa", paymentCount: 1, amountMinor: 8000 },
        ],
        topProducts: [
          {
            productId: "product-1",
            productName: "Premium flour",
            source: "operational",
            storeId: null,
            unit: "each",
            quantityMinor: 4,
            grossSalesMinor: 12000,
            saleCount: 3,
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  )
  vi.stubGlobal("fetch", fetch)

  await expect(
    getSalesInsights("2026-09-27", "2026-09-28")
  ).resolves.toMatchObject({
    summary: { netSalesMinor: 24000, averageBasketMinor: 6500 },
    cashiers: [expect.objectContaining({ cashierName: "Amina Cashier" })],
    topProducts: [expect.objectContaining({ productName: "Premium flour" })],
  })
  expect(fetch).toHaveBeenCalledWith(
    "/api/reports/sales?from=2026-09-27&to=2026-09-28",
    expect.objectContaining({ credentials: "same-origin" })
  )
})

it("requests one synchronized store explicitly", async () => {
  const storeId = "11111111-1111-4111-8111-111111111111"
  const source = {
    source: "edge" as const,
    storeId,
    label: "Synchronized store · 11111111",
  }
  const response = {
    from: "2026-10-02",
    to: "2026-10-02",
    days: 1,
    scope: source,
    availableSources: [source],
    reportingLag: {
      status: "lagging",
      pendingEvents: 0,
      receivedEvents: 2,
      projectedEvents: 1,
      latestReceivedAt: "2026-10-02T08:00:00.000Z",
    },
    coverage: { synchronizedReturns: "not_available" },
    summary: {
      saleCount: 1,
      grossSalesMinor: 5000,
      refundCount: 0,
      refundMinor: 0,
      netSalesMinor: 5000,
      averageBasketMinor: 5000,
      activeCashierCount: 1,
    },
    daily: [
      {
        day: "2026-10-02",
        saleCount: 1,
        grossSalesMinor: 5000,
        refundMinor: 0,
        netSalesMinor: 5000,
      },
    ],
    cashiers: [
      {
        cashierId: "edge-cashier",
        cashierName: "Edge Cashier",
        source: "edge",
        storeId,
        saleCount: 1,
        grossSalesMinor: 5000,
        refundMinor: 0,
        netSalesMinor: 5000,
        averageBasketMinor: 5000,
      },
    ],
    paymentMix: [{ kind: "cash", paymentCount: 1, amountMinor: 5000 }],
    topProducts: [
      {
        productId: "edge-product",
        productName: "Edge Product",
        source: "edge",
        storeId,
        unit: "each",
        quantityMinor: 1,
        grossSalesMinor: 5000,
        saleCount: 1,
      },
    ],
  }
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  )
  vi.stubGlobal("fetch", fetch)

  await expect(
    getSalesInsights("2026-10-02", "2026-10-02", source)
  ).resolves.toMatchObject({ scope: source })
  expect(fetch).toHaveBeenCalledWith(
    `/api/reports/sales?from=2026-10-02&to=2026-10-02&source=edge&storeId=${storeId}`,
    expect.objectContaining({ credentials: "same-origin" })
  )
})
