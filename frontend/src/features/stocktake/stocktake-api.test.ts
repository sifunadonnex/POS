import { afterEach, expect, it, vi } from "vitest"
import { countStock, stocktakeRequest } from "./stocktake-api"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it("posts a stocktake and parses the reconciliation result", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        countId: "11111111-1111-4111-8111-111111111111",
        productId: "22222222-2222-4222-8222-222222222222",
        quantityMinor: 8,
        deltaMinor: 3,
        previousQuantityMinor: 5,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  )
  vi.stubGlobal("fetch", fetch)

  await expect(
    countStock({
      productId: "22222222-2222-4222-8222-222222222222",
      quantity: "8",
      reason: "Physical count",
      requestId: "33333333-3333-4333-8333-333333333333",
    })
  ).resolves.toEqual(
    expect.objectContaining({ quantityMinor: 8, deltaMinor: 3 })
  )
  expect(fetch).toHaveBeenCalledWith(
    "/api/stocktake",
    expect.objectContaining({ credentials: "same-origin", method: "POST" })
  )
})

it("surfaces a server error without turning it into a success", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ message: "Only active products can be counted" }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }
      )
    )
  )

  await expect(stocktakeRequest({})).rejects.toMatchObject({
    message: "Only active products can be counted",
    status: 409,
  })
})
