import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { CatalogueScreen } from "./catalogue-screen"
import { ProductEditor } from "./product-editor"
import { CatalogueImport } from "./catalogue-import"
import { CatalogueError, type Product } from "./catalogue-api"

const mocks = vi.hoisted(() => ({
  getProducts: vi.fn(),
  getCategories: vi.fn(),
  catalogueRequest: vi.fn(),
  previewImport: vi.fn(),
}))
vi.mock("./catalogue-api", async (original) => ({
  ...(await original<typeof import("./catalogue-api")>()),
  ...mocks,
}))
const product: Product = {
  id: "b292f92a-6f3a-4511-972f-d81ecba9b38c",
  sku: "RICE",
  name: "Loose rice",
  categoryId: null,
  categoryName: null,
  unit: "kg",
  priceMinor: "18005",
  taxCode: null,
  active: true,
  revision: 1,
  barcodes: ["0012345"],
}
beforeEach(() => {
  mocks.getProducts.mockResolvedValue({ products: [product], hasMore: false })
  mocks.getCategories.mockResolvedValue([])
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it("lets cashiers search barcodes without exposing manager controls", async () => {
  render(<CatalogueScreen manager={false} />)
  expect(await screen.findByText("Loose rice")).toBeTruthy()
  expect(screen.getByText("KES 180.05", { exact: false })).toBeTruthy()
  for (const name of [
    "New product",
    "Import CSV",
    "Categories",
    "Edit Loose rice",
    "History of Loose rice",
  ])
    expect(screen.queryByRole("button", { name })).toBeNull()
  fireEvent.change(screen.getByLabelText("Search name, SKU or scan barcode"), {
    target: { value: "0012345" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Search" }))
  await waitFor(() =>
    expect(mocks.getProducts).toHaveBeenLastCalledWith({
      search: "0012345",
      status: "active",
      categoryId: "",
      page: 0,
    })
  )
})

it("shows catalogue failure and retry without inventing product rows", async () => {
  mocks.getProducts.mockRejectedValueOnce(
    new Error("Products are unavailable. Please retry.")
  )
  render(<CatalogueScreen manager />)
  expect((await screen.findByRole("alert")).textContent).toContain(
    "unavailable"
  )
  expect(screen.queryByText("Loose rice")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Retry catalogue" }))
  expect(await screen.findByText("Loose rice")).toBeTruthy()
})

function fillNewProduct() {
  fireEvent.change(screen.getByLabelText("SKU / product code"), {
    target: { value: "RICE" },
  })
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "Loose rice" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Kilogram" }))
  fireEvent.change(screen.getByLabelText("Selling price (KES / kg)"), {
    target: { value: "180.05" },
  })
  fireEvent.change(screen.getByLabelText("Barcodes (optional)"), {
    target: { value: "0012345" },
  })
  fireEvent.change(screen.getByLabelText("Reason for change"), {
    target: { value: "Opening catalogue" },
  })
}
it("preserves exact price text and barcodes and waits for a confirmed create", async () => {
  let resolve: ((value: unknown) => void) | undefined
  mocks.catalogueRequest.mockReturnValue(
    new Promise((done) => {
      resolve = done
    })
  )
  const saved = vi.fn()
  render(<ProductEditor product={null} categories={[]} onSaved={saved} />)
  fillNewProduct()
  fireEvent.click(screen.getByRole("button", { name: "Create product" }))
  await waitFor(() => expect(mocks.catalogueRequest).toHaveBeenCalledOnce())
  expect(mocks.catalogueRequest).toHaveBeenCalledWith(
    "products",
    expect.objectContaining({
      price: "180.05",
      unit: "kg",
      barcodes: ["0012345"],
      requestId: expect.any(String),
    }),
    "POST"
  )
  expect(saved).not.toHaveBeenCalled()
  await act(async () => {
    resolve?.({ product })
  })
  expect(saved).toHaveBeenCalledWith(product)
})

it("does not let a late response reset a different form after navigation", async () => {
  let resolve: ((value: unknown) => void) | undefined
  mocks.catalogueRequest.mockReturnValue(
    new Promise((done) => {
      resolve = done
    })
  )
  const saved = vi.fn()
  const view = render(
    <ProductEditor product={null} categories={[]} onSaved={saved} />
  )
  fillNewProduct()
  fireEvent.click(screen.getByRole("button", { name: "Create product" }))
  await waitFor(() => expect(mocks.catalogueRequest).toHaveBeenCalledOnce())
  view.unmount()
  await act(async () => {
    resolve?.({ product })
  })
  expect(saved).not.toHaveBeenCalled()
})

it("locks an uncertain save and retries the same payload and request ID", async () => {
  mocks.catalogueRequest
    .mockRejectedValueOnce(new CatalogueError("Connection lost", 0))
    .mockResolvedValueOnce({ product })
  const saved = vi.fn()
  render(<ProductEditor product={null} categories={[]} onSaved={saved} />)
  fillNewProduct()
  fireEvent.click(screen.getByRole("button", { name: "Create product" }))
  const retry = await screen.findByRole("button", { name: "Retry same save" })
  expect(saved).not.toHaveBeenCalled()
  expect(
    screen.getByLabelText("Product name").closest("fieldset")?.disabled
  ).toBe(true)
  fireEvent.click(retry)
  await waitFor(() => expect(saved).toHaveBeenCalledOnce())
  expect(mocks.catalogueRequest.mock.calls[1]).toEqual(
    mocks.catalogueRequest.mock.calls[0]
  )
})

it("keeps the sales unit fixed and reports a stale edit without success", async () => {
  mocks.catalogueRequest.mockRejectedValueOnce(
    new CatalogueError("This product changed. Reload before editing.", 409)
  )
  const saved = vi.fn()
  render(<ProductEditor product={product} categories={[]} onSaved={saved} />)
  expect(screen.getByRole("button", { name: "Item" })).toHaveProperty(
    "disabled",
    true
  )
  fireEvent.change(screen.getByLabelText("Reason for change"), {
    target: { value: "New shelf price" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Save product" }))
  expect((await screen.findByRole("alert")).textContent).toContain("Reload")
  expect(saved).not.toHaveBeenCalled()
  expect(mocks.catalogueRequest).toHaveBeenCalledWith(
    `products/${product.id}`,
    expect.objectContaining({ revision: 1 }),
    "PATCH"
  )
  expect(screen.queryByRole("button", { name: "Retry same save" })).toBeNull()
})

async function chooseCsv() {
  const file = new File(["sample"], "products.csv", { type: "text/csv" })
  Object.defineProperty(file, "arrayBuffer", {
    value: async () =>
      new TextEncoder().encode(
        "sku,name,category,unit,price,barcodes,tax_code\nRICE,Rice,,kg,180,001,"
      ).buffer,
  })
  fireEvent.change(screen.getByLabelText("CSV file"), {
    target: { files: [file] },
  })
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Preview import" })
    ).toHaveProperty("disabled", false)
  )
  fireEvent.click(screen.getByRole("button", { name: "Preview import" }))
}
it("shows import row errors and prevents importing an invalid preview", async () => {
  mocks.previewImport.mockResolvedValue({
    canImport: false,
    rows: [
      {
        row: 2,
        sku: "RICE",
        name: "Rice",
        categoryName: "",
        unit: "kg",
        priceMinor: "18000",
        errors: ["SKU already exists"],
      },
    ],
  })
  render(<CatalogueImport onImported={vi.fn()} />)
  await chooseCsv()
  expect(await screen.findByText("SKU already exists")).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Import 1 products" })).toBeNull()
  expect(mocks.catalogueRequest).not.toHaveBeenCalled()
})
it("imports only after preview and an explicit reason", async () => {
  mocks.previewImport.mockResolvedValue({
    canImport: true,
    rows: [
      {
        row: 2,
        sku: "RICE",
        name: "Rice",
        categoryName: "",
        unit: "kg",
        priceMinor: "18000",
        errors: [],
      },
    ],
  })
  mocks.catalogueRequest.mockResolvedValue({
    imported: 1,
    productIds: [product.id],
  })
  const imported = vi.fn()
  render(<CatalogueImport onImported={imported} />)
  await chooseCsv()
  fireEvent.change(await screen.findByLabelText("Reason for import"), {
    target: { value: "Opening catalogue" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Import 1 products" }))
  await waitFor(() => expect(imported).toHaveBeenCalledWith(1))
  expect(mocks.catalogueRequest).toHaveBeenCalledWith(
    "imports",
    expect.objectContaining({
      reason: "Opening catalogue",
      requestId: expect.any(String),
      csv: expect.stringContaining("001"),
    }),
    "POST"
  )
})
