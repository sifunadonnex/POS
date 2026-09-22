import { afterEach, expect, it, vi } from "vitest"
import {
  getSupplierLedger,
  getSuppliers,
  purchaseRequest,
} from "./purchases-api"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it("loads the supplier directory through the manager purchase endpoint", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        suppliers: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Alpha Foods",
            createdAt: "2026-09-21T08:00:00.000Z",
          },
        ],
        hasMore: false,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  )
  vi.stubGlobal("fetch", fetch)

  await expect(getSuppliers("alpha", 0)).resolves.toEqual({
    suppliers: [expect.objectContaining({ name: "Alpha Foods" })],
    hasMore: false,
  })
  expect(fetch).toHaveBeenCalledWith(
    "/api/purchases/suppliers?search=alpha&page=0",
    expect.objectContaining({ credentials: "same-origin", method: "GET" })
  )
})

it("surfaces a rejected purchase write", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Supplier not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    )
  )

  await expect(purchaseRequest("receive", {})).rejects.toMatchObject({
    message: "Supplier not found",
    status: 404,
  })
})

it("parses signed supplier ledger entries", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        supplier: {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Alpha Foods",
          createdAt: "2026-09-21T08:00:00.000Z",
        },
        from: "2026-09-09",
        to: "2026-09-21",
        hasMore: false,
        entries: [
          {
            entryId: "receipt-1",
            kind: "receipt",
            receiptId: "receipt-1",
            amountMinor: 20000,
            signedMinor: 20000,
            reason: "Delivery note 1042",
            createdAt: "2026-09-21T08:00:00.000Z",
          },
          {
            entryId: "return-1",
            kind: "return",
            receiptId: "receipt-1",
            amountMinor: 5000,
            signedMinor: -5000,
            reason: "Damaged goods",
            createdAt: "2026-09-21T09:00:00.000Z",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  )
  vi.stubGlobal("fetch", fetch)

  await expect(
    getSupplierLedger(
      "11111111-1111-4111-8111-111111111111",
      "2026-09-09",
      "2026-09-21"
    )
  ).resolves.toMatchObject({
    supplier: expect.objectContaining({ name: "Alpha Foods" }),
    entries: [
      expect.objectContaining({ signedMinor: 20000 }),
      expect.objectContaining({ signedMinor: -5000 }),
    ],
  })
  expect(fetch).toHaveBeenCalledWith(
    "/api/purchases/suppliers/11111111-1111-4111-8111-111111111111/ledger?from=2026-09-09&to=2026-09-21&page=0",
    expect.objectContaining({ method: "GET" })
  )
})
