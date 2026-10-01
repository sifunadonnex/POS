import { afterEach, expect, it, vi } from "vitest"
import {
  cancelHeldOrder,
  checkoutCashSale,
  createHeldOrder,
  getReceipt,
  getHeldOrders,
  getSaleDetail,
  getSalesLedger,
  resumeHeldOrder,
} from "./sales-api"

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

it("loads and validates the searchable sales ledger", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        sales: [
          {
            saleId: "11111111-1111-4111-8111-111111111111",
            cashierId: "cashier-1",
            cashierName: "Local Cashier",
            totalMinor: 1250,
            paidMinor: 1250,
            refundedMinor: 250,
            balanceMinor: 0,
            lineCount: 2,
            paymentKinds: ["cash"],
            paymentStatus: "paid",
            createdAt: "2026-09-21T08:00:00.000Z",
          },
        ],
        hasMore: false,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  )
  vi.stubGlobal("fetch", fetch)

  await expect(
    getSalesLedger({
      search: "11111111",
      from: "2026-09-01",
      to: "2026-09-30",
      page: 0,
    })
  ).resolves.toMatchObject({
    sales: [
      expect.objectContaining({ paymentStatus: "paid", refundedMinor: 250 }),
    ],
  })
  expect(fetch).toHaveBeenCalledWith(
    "/api/sales?search=11111111&from=2026-09-01&to=2026-09-30&page=0",
    expect.objectContaining({ method: "GET" })
  )
})

it("loads sale details for ledger drill-down", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          saleId: "11111111-1111-4111-8111-111111111111",
          cashierId: "cashier-1",
          cashierName: "Local Cashier",
          totalMinor: 1250,
          paidMinor: 1250,
          refundedMinor: 0,
          balanceMinor: 0,
          lineCount: 1,
          paymentKinds: ["cash"],
          paymentStatus: "paid",
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
              tenderedMinor: 2000,
              changeMinor: 750,
              paidAt: "2026-09-21T08:00:01.000Z",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    )
  )

  await expect(
    getSaleDetail("11111111-1111-4111-8111-111111111111")
  ).resolves.toMatchObject({
    cashierName: "Local Cashier",
    lines: [{ sku: "RICE" }],
    payments: [{ changeMinor: 750 }],
  })
})

it("loads and transitions server-held orders", async () => {
  const order = {
    id: "77777777-7777-4777-8777-777777777777",
    ownerId: "cashier-1",
    ownerName: "Local Cashier",
    note: "Customer collecting shortly",
    status: "held",
    revision: 1,
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
    lines: [
      {
        product: {
          id: "22222222-2222-4222-8222-222222222222",
          sku: "RICE",
          name: "Rice",
          categoryId: null,
          categoryName: null,
          unit: "each",
          priceMinor: "1250",
          taxCode: null,
          active: true,
          revision: 1,
          barcodes: [],
        },
        quantity: 1,
      },
    ],
  }
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ orders: [order] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify(order), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ...order, status: "resumed", revision: 2 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ...order, status: "cancelled", revision: 2 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    )
  vi.stubGlobal("fetch", fetch)

  await expect(getHeldOrders()).resolves.toMatchObject([
    { id: order.id, lines: [{ quantity: 1 }] },
  ])
  await createHeldOrder(
    [{ productId: order.lines[0].product.id, unit: "each", quantity: 1 }],
    order.note,
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  )
  await resumeHeldOrder(order.id, 1, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
  await cancelHeldOrder(order.id, 1, "cccccccc-cccc-4ccc-8ccc-cccccccccccc")

  expect(fetch).toHaveBeenNthCalledWith(
    2,
    "/api/sales/held-orders",
    expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("Customer collecting shortly"),
    })
  )
  expect(fetch).toHaveBeenNthCalledWith(
    3,
    `/api/sales/held-orders/${order.id}/resume`,
    expect.objectContaining({ method: "POST" })
  )
})
