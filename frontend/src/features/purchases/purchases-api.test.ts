import { afterEach, expect, it, vi } from "vitest"
import { getSuppliers, purchaseRequest } from "./purchases-api"

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
