import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { PurchaseError } from "./purchases-api"
import { PurchaseIntakeScreen } from "./purchase-intake-screen"

const mocks = vi.hoisted(() => ({
  getSuppliers: vi.fn(),
  createSupplier: vi.fn(),
  receivePurchase: vi.fn(),
  getProducts: vi.fn(),
}))

vi.mock("./purchases-api", async (original) => ({
  ...(await original<typeof import("./purchases-api")>()),
  ...mocks,
}))
vi.mock("@/features/catalogue/catalogue-api", async (original) => ({
  ...(await original<typeof import("@/features/catalogue/catalogue-api")>()),
  getProducts: mocks.getProducts,
}))

const supplier = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Alpha Foods",
  createdAt: "2026-09-21T08:00:00.000Z",
}
const product = {
  id: "22222222-2222-4222-8222-222222222222",
  sku: "RICE",
  name: "Loose rice",
  categoryId: null,
  categoryName: null,
  unit: "kg" as const,
  priceMinor: "18000",
  taxCode: null,
  active: true,
  revision: 1,
  barcodes: [],
}

beforeEach(() => {
  mocks.getSuppliers.mockResolvedValue({
    suppliers: [supplier],
    hasMore: false,
  })
  mocks.getProducts.mockResolvedValue({ products: [product], hasMore: false })
  mocks.receivePurchase.mockResolvedValue({
    receiptId: "33333333-3333-4333-8333-333333333333",
    supplierId: supplier.id,
    totalMinor: 2000,
    status: "received",
  })
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it("posts a supplier receipt with exact quantity and cost values", async () => {
  render(<PurchaseIntakeScreen />)
  expect((await screen.findAllByText("Alpha Foods")).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole("button", { name: /Loose rice/ }))
  fireEvent.change(screen.getByLabelText("Quantity"), {
    target: { value: "1.250" },
  })
  fireEvent.change(screen.getByLabelText("Unit cost (KES)"), {
    target: { value: "16.00" },
  })
  fireEvent.change(screen.getByLabelText("Reason for receipt"), {
    target: { value: "Delivery note 1042" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Post receipt" }))

  await waitFor(() => expect(mocks.receivePurchase).toHaveBeenCalledOnce())
  expect(mocks.receivePurchase).toHaveBeenCalledWith({
    supplierId: supplier.id,
    reason: "Delivery note 1042",
    requestId: expect.any(String),
    lines: [
      { productId: product.id, quantity: "1.250", unitCostMinor: "1600" },
    ],
  })
  expect((await screen.findByRole("status")).textContent).toContain("confirmed")
})

it("retries an uncertain receipt with the same request ID and payload", async () => {
  mocks.receivePurchase
    .mockRejectedValueOnce(new PurchaseError("Connection lost", 0))
    .mockResolvedValueOnce({
      receiptId: "33333333-3333-4333-8333-333333333333",
      supplierId: supplier.id,
      totalMinor: 2000,
      status: "received",
    })
  render(<PurchaseIntakeScreen />)
  await screen.findAllByText("Alpha Foods")
  fireEvent.click(screen.getByRole("button", { name: /Loose rice/ }))
  fireEvent.change(screen.getByLabelText("Quantity"), {
    target: { value: "1.250" },
  })
  fireEvent.change(screen.getByLabelText("Unit cost (KES)"), {
    target: { value: "16.00" },
  })
  fireEvent.change(screen.getByLabelText("Reason for receipt"), {
    target: { value: "Delivery note 1042" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Post receipt" }))

  const retry = await screen.findByRole("button", {
    name: "Retry same receipt",
  })
  fireEvent.click(retry)
  await waitFor(() => expect(mocks.receivePurchase).toHaveBeenCalledTimes(2))
  expect(mocks.receivePurchase.mock.calls[1]).toEqual(
    mocks.receivePurchase.mock.calls[0]
  )
})
