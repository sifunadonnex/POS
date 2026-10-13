import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { ProductPhotoEditor } from "./product-photo-editor"
import type { Product } from "./catalogue-api"
const request = vi.hoisted(() => vi.fn())
vi.mock("./catalogue-api", async (original) => ({
  ...(await original<typeof import("./catalogue-api")>()),
  catalogueRequest: request,
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
const product: Product = {
  id: "product-id",
  sku: "RICE",
  name: "Rice",
  categoryId: null,
  categoryName: null,
  unit: "kg",
  priceMinor: "20000",
  lowStockThresholdMinor: null,
  taxCode: null,
  active: true,
  revision: 3,
  barcodes: [],
  hasImage: true,
}
it("removes a photo with revision, reason and a replay-safe request ID", async () => {
  const onSaved = vi.fn()
  request.mockResolvedValue({
    product: { ...product, revision: 4, hasImage: false },
  })
  render(<ProductPhotoEditor product={product} onSaved={onSaved} />)
  fireEvent.change(screen.getByLabelText("Reason for photo change"), {
    target: { value: "Photo no longer represents product" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Remove photo" }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "products/product-id/photo",
      {
        revision: 3,
        reason: "Photo no longer represents product",
        photo: null,
        requestId: expect.any(String),
      },
      "POST"
    )
  )
  expect(onSaved).toHaveBeenCalledWith(
    expect.objectContaining({ hasImage: false, revision: 4 })
  )
})
it("rejects unsupported files without submitting them", async () => {
  render(<ProductPhotoEditor product={product} onSaved={vi.fn()} />)
  fireEvent.change(screen.getByLabelText("Choose photo"), {
    target: {
      files: [new File(["<svg/>"], "photo.svg", { type: "image/svg+xml" })],
    },
  })
  expect((await screen.findByRole("alert")).textContent).toContain(
    "PNG, JPEG or WebP"
  )
  expect(request).not.toHaveBeenCalled()
})
it("blocks photo changes while the product's other save is pending", () => {
  render(<ProductPhotoEditor product={product} onSaved={vi.fn()} blocked />)
  expect(screen.getByLabelText("Choose photo")).toHaveProperty("disabled", true)
  expect(screen.getByRole("button", { name: "Remove photo" })).toHaveProperty(
    "disabled",
    true
  )
  fireEvent.click(screen.getByRole("button", { name: "Remove photo" }))
  expect(request).not.toHaveBeenCalled()
})
