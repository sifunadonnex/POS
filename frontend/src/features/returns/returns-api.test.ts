import { afterEach, expect, it, vi } from "vitest"
import { getSale, returnsRequest } from "./returns-api"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it("loads a sale with quantities available for return", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        saleId: "11111111-1111-4111-8111-111111111111",
        totalMinor: 1000,
        refundedMinor: 0,
        refundableMinor: 1000,
        createdAt: "2026-09-21T09:00:00.000Z",
        lines: [
          {
            productId: "22222222-2222-4222-8222-222222222222",
            name: "Milk",
            sku: "MILK",
            unit: "each",
            soldQuantityMinor: 2,
            returnedQuantityMinor: 0,
            availableQuantityMinor: 2,
            unitPriceMinor: 500,
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  )
  vi.stubGlobal("fetch", fetch)

  await expect(
    getSale("11111111-1111-4111-8111-111111111111")
  ).resolves.toEqual(
    expect.objectContaining({
      lines: [expect.objectContaining({ availableQuantityMinor: 2 })],
    })
  )
})

it("surfaces a rejected return request", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "Return quantity exceeds the sold quantity",
        }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }
      )
    )
  )

  await expect(returnsRequest("", {})).rejects.toMatchObject({
    message: "Return quantity exceeds the sold quantity",
    status: 409,
  })
})
