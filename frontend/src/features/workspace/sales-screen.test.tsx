import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { SalesScreen } from "./sales-screen"
import type { Product } from "../catalogue/catalogue-api"

const mocks = vi.hoisted(() => ({
  getProducts: vi.fn(),
  getProductByBarcode: vi.fn(),
  getCurrentShift: vi.fn(),
  openShift: vi.fn(),
  closeShift: vi.fn(),
  quoteBasket: vi.fn(),
  finalizeSale: vi.fn(),
  recordPayment: vi.fn(),
}))

vi.mock("../catalogue/catalogue-api", async (original) => ({
  ...(await original<typeof import("../catalogue/catalogue-api")>()),
  ...mocks,
}))
vi.mock("../sales/sales-api", async (original) => ({
  ...(await original<typeof import("../sales/sales-api")>()),
  ...mocks,
}))
vi.mock("../sales/shifts-api", async (original) => ({
  ...(await original<typeof import("../sales/shifts-api")>()),
  ...mocks,
}))

const product: Product = {
  id: "b292f92a-6f3a-4511-972f-d81ecba9b38c",
  sku: "RICE",
  name: "Rice 10kg",
  categoryId: null,
  categoryName: null,
  unit: "each",
  priceMinor: "1250",
  taxCode: null,
  active: true,
  revision: 1,
  barcodes: ["0012345"],
}

beforeEach(() => {
  mocks.getCurrentShift.mockResolvedValue({
    shiftId: "shift-1",
    openingCashMinor: 5000,
    status: "open",
    openedAt: "2026-09-21T08:00:00.000Z",
  })
  mocks.getProducts.mockResolvedValue({ products: [product], hasMore: false })
  mocks.getProductByBarcode.mockRejectedValue(new Error("not a barcode"))
  mocks.quoteBasket.mockResolvedValue({
    subtotalMinor: 1250,
    totalMinor: 1250,
    lines: [
      {
        productId: product.id,
        unit: "each",
        quantity: 1,
        priceMinor: 1250,
        lineTotalMinor: 1250,
      },
    ],
  })
  mocks.finalizeSale.mockResolvedValue({
    saleId: "sale-1",
    totalMinor: 1250,
    lines: [],
  })
  mocks.recordPayment.mockResolvedValue({
    paymentId: "payment-1",
    saleId: "sale-1",
    kind: "cash",
    amountMinor: 1250,
    totalMinor: 1250,
  })
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it("adds a real catalogue product and confirms the sale and payment", async () => {
  render(<SalesScreen />)
  const productButton = await screen.findByRole("button", { name: /Rice 10kg/ })
  fireEvent.click(productButton)

  expect(await screen.findByDisplayValue("12.50")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Complete sale" }))

  await waitFor(() => expect(mocks.recordPayment).toHaveBeenCalledOnce())
  expect(mocks.finalizeSale).toHaveBeenCalledWith(
    [{ productId: product.id, unit: "each", quantity: 1 }],
    expect.any(String)
  )
  expect(mocks.recordPayment).toHaveBeenCalledWith(
    "sale-1",
    "cash",
    1250,
    expect.any(String)
  )
  expect((await screen.findByRole("status")).textContent).toContain(
    "Sale confirmed"
  )
})

it("does not invent a sale when the server quote fails", async () => {
  mocks.quoteBasket.mockRejectedValueOnce(
    new Error("The current price could not be confirmed")
  )
  render(<SalesScreen />)
  fireEvent.click(await screen.findByRole("button", { name: /Rice 10kg/ }))

  expect(
    await screen.findByText("The current price could not be confirmed")
  ).toBeTruthy()
  expect(mocks.finalizeSale).not.toHaveBeenCalled()
  expect(screen.getByRole("button", { name: "Complete sale" })).toHaveProperty(
    "disabled",
    true
  )
})

it("requires an open shift before allowing a product into the basket", async () => {
  mocks.getCurrentShift.mockResolvedValue(null)
  render(<SalesScreen />)
  expect(
    await screen.findByText("Open the register to start selling")
  ).toBeTruthy()
  expect(screen.getByRole("button", { name: /Rice 10kg/ })).toHaveProperty(
    "disabled",
    true
  )
})
