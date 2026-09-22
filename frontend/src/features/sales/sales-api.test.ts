import { afterEach, expect, it, vi } from "vitest"
import { checkoutCashSale, getReceipt } from "./sales-api"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it("loads a paid receipt from the server for reprinting", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        saleId: "11111111-1111-4111-8111-111111111111",
        totalMinor: 1250,
        createdAt: "2026-09-21T08:00:00.000Z",
        lines: [
          {
            productId: "22222222-2222-4222-8222-222222222222",
            name: "Rice",
            sku: "RICE",
            unit: "each",
            quantity: 1,
            unitPriceMinor: 1250,
            lineTotalMinor: 1250,
          },
        ],
        payments: [
          {
            paymentId: "33333333-3333-4333-8333-333333333333",
            kind: "cash",
            amountMinor: 1250,
            tenderedMinor: 1250,
            changeMinor: 0,
            paidAt: "2026-09-21T08:00:01.000Z",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  )
  vi.stubGlobal("fetch", fetch)

  await expect(
    getReceipt("11111111-1111-4111-8111-111111111111")
  ).resolves.toMatchObject({ saleId: "11111111-1111-4111-8111-111111111111" })
  expect(fetch).toHaveBeenCalledWith(
    "/api/sales/11111111-1111-4111-8111-111111111111/receipt",
    expect.objectContaining({ credentials: "same-origin", method: "GET" })
  )
})

it("surfaces receipt lookup errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Completed sale not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    )
  )

  await expect(
    getReceipt("11111111-1111-4111-8111-111111111111")
  ).rejects.toMatchObject({
    message: "Completed sale not found",
    status: 404,
  })
})

it("submits a replay-safe cash checkout with the amount tendered", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        saleId: "11111111-1111-4111-8111-111111111111",
        totalMinor: 1250,
        lines: [
          {
            productId: "22222222-2222-4222-8222-222222222222",
            unit: "each",
            quantity: 1,
            priceMinor: 1250,
            lineTotalMinor: 1250,
          },
        ],
        payment: {
          paymentId: "33333333-3333-4333-8333-333333333333",
          shiftId: "44444444-4444-4444-8444-444444444444",
          kind: "cash",
          amountMinor: 1250,
          tenderedMinor: 2000,
          changeMinor: 750,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  )
  vi.stubGlobal("fetch", fetch)

  await expect(
    checkoutCashSale(
      [
        {
          productId: "22222222-2222-4222-8222-222222222222",
          unit: "each",
          quantity: 1,
        },
      ],
      2000,
      "11111111-1111-4111-8111-111111111111"
    )
  ).resolves.toMatchObject({
    saleId: "11111111-1111-4111-8111-111111111111",
    payment: { tenderedMinor: 2000, changeMinor: 750 },
  })
  expect(fetch).toHaveBeenCalledWith(
    "/api/sales/checkout",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        lines: [
          {
            productId: "22222222-2222-4222-8222-222222222222",
            unit: "each",
            quantity: 1,
          },
        ],
        cashTenderedMinor: 2000,
        requestId: "11111111-1111-4111-8111-111111111111",
        reason: "Cash register sale",
      }),
    })
  )
})
