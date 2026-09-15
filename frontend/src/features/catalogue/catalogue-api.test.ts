import { afterEach, expect, it, vi } from "vitest"
import { catalogueRequest, parseProduct } from "./catalogue-api"
import { displayPrice, priceText } from "./catalogue-format"

afterEach(() => vi.unstubAllGlobals())
it("formats exact minor units without rounding away cents", () => {
  expect(priceText("1")).toBe("0.01")
  expect(displayPrice("999999999")).toBe("KES 9,999,999.99")
})
it("rejects malformed price and unit responses", () => {
  const product = {
    id: "id",
    sku: "SKU",
    name: "Product",
    categoryId: null,
    categoryName: null,
    unit: "kg",
    priceMinor: "100",
    taxCode: null,
    active: true,
    revision: 1,
    barcodes: [],
  }
  expect(() => parseProduct({ ...product, priceMinor: 100 })).toThrow()
  expect(() => parseProduct({ ...product, unit: "tonne" })).toThrow()
})
it("signals session expiry and preserves HTTP error status", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "Sign in again" }), {
          status: 401,
        })
      )
  )
  const expired = vi.fn()
  window.addEventListener("paygo-session-expired", expired)
  try {
    await expect(catalogueRequest("products")).rejects.toMatchObject({
      status: 401,
      message: "Sign in again",
    })
    expect(expired).toHaveBeenCalledOnce()
  } finally {
    window.removeEventListener("paygo-session-expired", expired)
  }
})
