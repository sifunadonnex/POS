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
  checkoutCashSale: vi.fn(),
  finalizeSale: vi.fn(),
  getReceipt: vi.fn(),
  getPaymentCapabilities: vi.fn(),
  startPaymentAttempt: vi.fn(),
  reconcilePaymentAttempt: vi.fn(),
}))

vi.mock("../catalogue/catalogue-api", async (original) => ({
  ...(await original<typeof import("../catalogue/catalogue-api")>()),
  ...mocks,
}))
vi.mock("../sales/sales-api", async (original) => ({
  ...(await original<typeof import("../sales/sales-api")>()),
  ...mocks,
}))
vi.mock("../sales/payment-attempts-api", async (original) => ({
  ...(await original<typeof import("../sales/payment-attempts-api")>()),
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
  mocks.getPaymentCapabilities.mockResolvedValue({ card: false, mpesa: false })
  mocks.finalizeSale.mockResolvedValue({
    saleId: "sale-1",
    totalMinor: 1250,
    lines: [],
  })
  mocks.checkoutCashSale.mockResolvedValue({
    saleId: "sale-1",
    totalMinor: 1250,
    lines: [],
    payment: {
      paymentId: "payment-1",
      saleId: "sale-1",
      kind: "cash",
      amountMinor: 1250,
      totalMinor: 1250,
      shiftId: "shift-1",
      tenderedMinor: 2000,
      changeMinor: 750,
    },
  })
  mocks.getReceipt.mockResolvedValue({
    saleId: "sale-1",
    totalMinor: 1250,
    createdAt: "2026-09-21T08:00:00.000Z",
    lines: [
      {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        unit: product.unit,
        quantity: 1,
        unitPriceMinor: 1250,
        lineTotalMinor: 1250,
      },
    ],
    payments: [
      {
        paymentId: "payment-1",
        kind: "cash",
        amountMinor: 1250,
        tenderedMinor: 2000,
        changeMinor: 750,
        paidAt: "2026-09-21T08:00:01.000Z",
      },
    ],
  })
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.resetAllMocks()
})

it("checks out cash atomically and prints tender and change on the receipt", async () => {
  render(<SalesScreen />)
  const productButton = await screen.findByRole("button", { name: /Rice 10kg/ })
  fireEvent.click(productButton)

  const cashReceived = await screen.findByLabelText("Cash received (KES)")
  fireEvent.change(cashReceived, { target: { value: "20.00" } })
  expect(await screen.findByText("Change due")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Complete sale" }))

  await waitFor(() => expect(mocks.checkoutCashSale).toHaveBeenCalledOnce())
  expect(mocks.checkoutCashSale).toHaveBeenCalledWith(
    [{ productId: product.id, unit: "each", quantity: 1 }],
    2000,
    expect.any(String)
  )
  expect((await screen.findByRole("status")).textContent).toContain(
    "Change due KES 7.50"
  )
  expect(await screen.findByLabelText("Receipt")).toBeTruthy()
  expect(screen.getByText("Change given")).toBeTruthy()
})

it("holds a basket locally and resumes it for a fresh server quote", async () => {
  render(<SalesScreen />)
  fireEvent.click(await screen.findByRole("button", { name: /Rice 10kg/ }))
  fireEvent.click(screen.getByRole("button", { name: "Hold" }))

  expect(await screen.findByText("Basket is empty")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Resume" }))

  expect(
    await screen.findByText("Held basket resumed and re-quoted by the server.")
  ).toBeTruthy()
  await waitFor(() => expect(mocks.quoteBasket).toHaveBeenCalledTimes(2))
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
  expect(mocks.checkoutCashSale).not.toHaveBeenCalled()
  expect(screen.getByRole("button", { name: "Complete sale" })).toHaveProperty(
    "disabled",
    true
  )
})

it("does not present card or M-Pesa as working payment methods", async () => {
  render(<SalesScreen />)
  fireEvent.click(await screen.findByRole("button", { name: /Rice 10kg/ }))

  expect(screen.getByRole("button", { name: "Card" })).toHaveProperty(
    "disabled",
    true
  )
  expect(screen.getByRole("button", { name: "M-Pesa" })).toHaveProperty(
    "disabled",
    true
  )
})

it("records a confirmed external payment before showing the receipt", async () => {
  mocks.getPaymentCapabilities.mockResolvedValue({ card: true, mpesa: true })
  mocks.startPaymentAttempt.mockResolvedValue({
    attemptId: "attempt-1",
    saleId: "sale-1",
    shiftId: "shift-1",
    kind: "card",
    provider: "verified-provider",
    providerReference: "provider-1",
    amountMinor: 1250,
    status: "confirmed",
    paymentId: "payment-1",
    createdAt: "2026-09-28T08:00:00.000Z",
    updatedAt: "2026-09-28T08:00:01.000Z",
    confirmedAt: "2026-09-28T08:00:01.000Z",
  })

  render(<SalesScreen />)
  fireEvent.click(await screen.findByRole("button", { name: /Rice 10kg/ }))
  const card = screen.getByRole("button", { name: "Card" })
  await waitFor(() => expect(card).toHaveProperty("disabled", false))
  fireEvent.click(card)
  fireEvent.click(screen.getByRole("button", { name: "Complete sale" }))

  await waitFor(() => expect(mocks.finalizeSale).toHaveBeenCalledOnce())
  expect(mocks.startPaymentAttempt).toHaveBeenCalledWith(
    "sale-1",
    "card",
    expect.any(String)
  )
  expect(await screen.findByText(/Card payment confirmed/)).toBeTruthy()
  expect(await screen.findByLabelText("Receipt")).toBeTruthy()
})

it("freezes an unknown external payment and reconciles the same attempt", async () => {
  mocks.getPaymentCapabilities.mockResolvedValue({ card: false, mpesa: true })
  const unknownAttempt = {
    attemptId: "attempt-1",
    saleId: "sale-1",
    shiftId: "shift-1",
    kind: "mpesa",
    provider: "verified-provider",
    providerReference: "provider-1",
    amountMinor: 1250,
    status: "unknown",
    paymentId: null,
    createdAt: "2026-09-28T08:00:00.000Z",
    updatedAt: "2026-09-28T08:00:01.000Z",
    confirmedAt: null,
  }
  mocks.startPaymentAttempt.mockResolvedValue(unknownAttempt)
  mocks.reconcilePaymentAttempt.mockResolvedValue({
    ...unknownAttempt,
    status: "confirmed",
    paymentId: "payment-1",
    confirmedAt: "2026-09-28T08:00:02.000Z",
  })

  render(<SalesScreen />)
  fireEvent.click(await screen.findByRole("button", { name: /Rice 10kg/ }))
  const mpesa = screen.getByRole("button", { name: "M-Pesa" })
  await waitFor(() => expect(mpesa).toHaveProperty("disabled", false))
  fireEvent.click(mpesa)
  fireEvent.click(screen.getByRole("button", { name: "Complete sale" }))

  expect(await screen.findByText("Payment unknown · attempt-")).toBeTruthy()
  expect(
    screen.getByRole("button", { name: /Remove Rice 10kg/ })
  ).toHaveProperty("disabled", true)
  fireEvent.click(screen.getByRole("button", { name: "Check payment status" }))

  await waitFor(() =>
    expect(mocks.reconcilePaymentAttempt).toHaveBeenCalledWith("attempt-1")
  )
  expect(await screen.findByText(/M-Pesa payment confirmed/)).toBeTruthy()
  expect(mocks.finalizeSale).toHaveBeenCalledOnce()
  expect(mocks.startPaymentAttempt).toHaveBeenCalledOnce()
})

it("restores an unresolved payment after a register refresh", async () => {
  window.localStorage.setItem(
    "paygo-external-payment",
    JSON.stringify({
      saleId: "sale-1",
      kind: "mpesa",
      requestId: "request-1",
      attempt: { attemptId: "attempt-1", status: "unknown" },
    })
  )
  mocks.reconcilePaymentAttempt.mockResolvedValue({
    attemptId: "attempt-1",
    saleId: "sale-1",
    shiftId: "shift-1",
    kind: "mpesa",
    provider: "verified-provider",
    providerReference: "provider-1",
    amountMinor: 1250,
    status: "confirmed",
    paymentId: "payment-1",
    createdAt: "2026-09-28T08:00:00.000Z",
    updatedAt: "2026-09-28T08:00:02.000Z",
    confirmedAt: "2026-09-28T08:00:02.000Z",
  })

  render(<SalesScreen />)
  expect(await screen.findByText("Payment unknown · attempt-")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Check payment status" }))

  await waitFor(() =>
    expect(mocks.reconcilePaymentAttempt).toHaveBeenCalledWith("attempt-1")
  )
  expect(await screen.findByText(/M-Pesa payment confirmed/)).toBeTruthy()
  expect(window.localStorage.getItem("paygo-external-payment")).toBeNull()
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
