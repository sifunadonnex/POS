import { afterEach, expect, it, vi } from "vitest"
import { getHistory, getStock, inventoryRequest } from "./inventory-api"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it("parses stock balances and sends same-origin requests", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        stock: [
          {
            productId: "11111111-1111-4111-8111-111111111111",
            sku: "RICE",
            name: "Loose rice",
            unit: "kg",
            quantityMinor: 1250,
            active: true,
          },
        ],
        hasMore: false,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  )
  vi.stubGlobal("fetch", fetch)

  await expect(getStock("rice", 0)).resolves.toEqual({
    stock: [
      expect.objectContaining({ name: "Loose rice", quantityMinor: 1250 }),
    ],
    hasMore: false,
  })
  expect(fetch).toHaveBeenCalledWith(
    "/api/inventory/stock?search=rice&page=0",
    expect.objectContaining({ credentials: "same-origin", method: "GET" })
  )
})

it("surfaces a server error without turning it into a success", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Insufficient stock" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      })
    )
  )

  await expect(
    inventoryRequest("adjust", { quantity: -4 })
  ).rejects.toMatchObject({
    message: "Insufficient stock",
    status: 409,
  })
})

it("accepts sale and return movements in the stock history contract", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          history: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              kind: "sale",
              deltaMinor: -1250,
              quantityAfterMinor: 5000,
              reason: "Cash checkout",
              createdAt: "2026-09-22T08:00:00.000Z",
              actorName: "Cashier",
            },
            {
              id: "22222222-2222-4222-8222-222222222222",
              kind: "return",
              deltaMinor: 1250,
              quantityAfterMinor: 6250,
              reason: "Customer return",
              createdAt: "2026-09-22T08:01:00.000Z",
              actorName: "Manager",
            },
          ],
          hasMore: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    )
  )

  await expect(
    getHistory("33333333-3333-4333-8333-333333333333", 0)
  ).resolves.toMatchObject({
    history: [
      { kind: "sale", deltaMinor: -1250 },
      { kind: "return", deltaMinor: 1250 },
    ],
  })
})
