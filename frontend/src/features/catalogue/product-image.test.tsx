import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { ProductImage } from "./product-image"
import type { Product } from "./catalogue-api"
afterEach(cleanup)
const product: Product = {
  id: "product-1",
  sku: "RICE",
  name: "Rice",
  unit: "kg",
  priceMinor: "20000",
  categoryId: null,
  categoryName: null,
  lowStockThresholdMinor: null,
  taxCode: null,
  active: true,
  revision: 1,
  barcodes: [],
}
it("keeps products without photos and failed images readable, and retries a new revision", () => {
  const view = render(<ProductImage product={product} />)
  expect(screen.getByLabelText("No photo for Rice")).toBeTruthy()
  expect(view.container.querySelector("img")).toBeNull()
  view.rerender(<ProductImage product={{ ...product, hasImage: true }} />)
  const image = view.container.querySelector("img")
  if (!image) throw new Error("Expected product image")
  fireEvent.error(image)
  expect(screen.getByLabelText("No photo for Rice")).toBeTruthy()
  view.rerender(
    <ProductImage product={{ ...product, hasImage: true, revision: 2 }} />
  )
  expect(view.container.querySelector("img")?.src).toContain("v=2")
})
