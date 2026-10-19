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
  getRegisterBasket: vi.fn(),
  saveRegisterBasket: vi.fn(),
  checkoutCashSale: vi.fn(),
  finalizeSale: vi.fn(),
  getReceipt: vi.fn(),
  getHeldOrders: vi.fn(),
  createHeldOrder: vi.fn(),
  resumeHeldOrder: vi.fn(),
  cancelHeldOrder: vi.fn(),
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
  availableQuantityMinor: "100",
  lowStockThresholdMinor: null,
  taxCode: null,
  active: true,
  revision: 1,
  barcodes: ["0012345"],
}

const heldOrder = {
  id: "77777777-7777-4777-8777-777777777777",
  ownerId: "cashier-1",
  ownerName: "Local Cashier",
  note: "Customer collecting shortly",
  status: "held" as const,
  revision: 1,
  createdAt: "2026-10-01T08:00:00.000Z",
  updatedAt: "2026-10-01T08:00:00.000Z",
  lines: [{ product, quantity: 1 }],
}

beforeEach(() => {
  mocks.getRegisterBasket.mockResolvedValue({ revision: 0, lines: [] })
  mocks.saveRegisterBasket.mockImplementation(async (lines) => ({
    revision: 1,
    quote: lines.length
      ? await mocks.quoteBasket(lines)
      : { subtotalMinor: 0, totalMinor: 0, lines: [] },
  }))
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
  mocks.getHeldOrders.mockResolvedValue([])
  mocks.createHeldOrder.mockResolvedValue(heldOrder)
  mocks.resumeHeldOrder.mockResolvedValue({
    ...heldOrder,
    status: "resumed",
    revision: 2,
  })
  mocks.cancelHeldOrder.mockResolvedValue({
    ...heldOrder,
    status: "cancelled",
    revision: 2,
  })
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
  vi.restoreAllMocks()
})

it("checks out cash atomically and prints tender and change on the receipt", async () => {
  const print = vi.spyOn(window, "print").mockImplementation(() => undefined)
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
  expect(await screen.findByLabelText("Printable receipt")).toBeTruthy()
  expect(screen.getByText("TEST — NOT A TAX INVOICE")).toBeTruthy()
  expect(screen.getByText("Change")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Print" }))
  expect(print).toHaveBeenCalledOnce()
})

it("holds a basket on the server and resumes it for a fresh quote", async () => {
  render(<SalesScreen />)
  fireEvent.click(await screen.findByRole("button", { name: /Rice 10kg/ }))
  fireEvent.change(await screen.findByLabelText("Hold note (optional)"), {
    target: { value: "Customer collecting shortly" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Hold" }))

  expect(await screen.findByText("Basket is empty")).toBeTruthy()
  expect(mocks.createHeldOrder).toHaveBeenCalledWith(
    [{ productId: product.id, unit: "each", quantity: 1 }],
    "Customer collecting shortly",
    expect.any(String)
  )
  mocks.getRegisterBasket.mockResolvedValue({
    revision: 3,
    lines: heldOrder.lines,
  })
  fireEvent.click(screen.getByRole("button", { name: "Resume" }))

  expect(
    await screen.findByText("Held order resumed and re-quoted by the server.")
  ).toBeTruthy()
  expect(mocks.resumeHeldOrder).toHaveBeenCalledWith(
    heldOrder.id,
    heldOrder.revision,
    expect.any(String)
  )
  await waitFor(() => expect(mocks.quoteBasket).toHaveBeenCalledTimes(2))
})

it("cancels a held order through its server transition", async () => {
  mocks.getHeldOrders.mockResolvedValue([heldOrder])
  render(<SalesScreen staffRole="supervisor" />)

  fireEvent.click(
    await screen.findByRole("button", { name: "Cancel held order 77777777" })
  )

  await waitFor(() =>
    expect(mocks.cancelHeldOrder).toHaveBeenCalledWith(
      heldOrder.id,
      heldOrder.revision,
      expect.any(String),
      undefined
    )
  )
  expect(
    await screen.findByText(
      "Held order cancelled. Its history remains recorded."
    )
  ).toBeTruthy()
  expect(screen.getByText("No held orders")).toBeTruthy()
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
    expect.any(String),
    undefined
  )
  expect(await screen.findByText(/Card payment confirmed/)).toBeTruthy()
  expect(await screen.findByLabelText("Receipt")).toBeTruthy()
})

it("freezes an unknown external payment and reconciles the same attempt", async () => {
  mocks.getPaymentCapabilities.mockResolvedValue({ card: false, mpesa: true })
  mocks.quoteBasket.mockResolvedValue({
    subtotalMinor: 1200,
    totalMinor: 1200,
    lines: [
      {
        productId: product.id,
        unit: "each",
        quantity: 1,
        priceMinor: 1200,
        lineTotalMinor: 1200,
      },
    ],
  })
  const unknownAttempt = {
    attemptId: "attempt-1",
    saleId: "sale-1",
    shiftId: "shift-1",
    kind: "mpesa",
    provider: "verified-provider",
    providerReference: "provider-1",
    amountMinor: 1200,
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
  fireEvent.change(screen.getByLabelText("Customer M-Pesa phone"), {
    target: { value: "0712345678" },
  })
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
  expect(mocks.startPaymentAttempt).toHaveBeenCalledWith(
    "sale-1",
    "mpesa",
    expect.any(String),
    "0712345678"
  )
})

it("requires a valid phone and whole-KES total for M-Pesa", async () => {
  mocks.getPaymentCapabilities.mockResolvedValue({ card: false, mpesa: true })
  mocks.quoteBasket.mockResolvedValue({
    subtotalMinor: 1251,
    totalMinor: 1251,
    lines: [
      {
        productId: product.id,
        unit: "each",
        quantity: 1,
        priceMinor: 1251,
        lineTotalMinor: 1251,
      },
    ],
  })

  render(<SalesScreen />)
  fireEvent.click(await screen.findByRole("button", { name: /Rice 10kg/ }))
  const mpesa = screen.getByRole("button", { name: "M-Pesa" })
  await waitFor(() => expect(mpesa).toHaveProperty("disabled", false))
  fireEvent.click(mpesa)
  fireEvent.change(screen.getByLabelText("Customer M-Pesa phone"), {
    target: { value: "123" },
  })

  expect(await screen.findByText(/whole-KES total/)).toBeTruthy()
  expect(screen.getByRole("button", { name: "Complete sale" })).toHaveProperty(
    "disabled",
    true
  )
  expect(mocks.finalizeSale).not.toHaveBeenCalled()
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

it("asks for supervisor approval before a cashier removes an item", async () => {
  render(<SalesScreen staffRole="cashier" />)
  const productButton = await screen.findByRole("button", { name: /Rice 10kg/ })
  await waitFor(() =>
    expect(productButton.hasAttribute("disabled")).toBe(false)
  )
  fireEvent.click(productButton)
  const remove = await screen.findByRole("button", { name: /Remove Rice 10kg/ })
  await waitFor(() => expect(remove.hasAttribute("disabled")).toBe(false))
  fireEvent.click(remove)
  expect(await screen.findByRole("dialog")).toBeTruthy()
  expect(mocks.saveRegisterBasket).toHaveBeenCalledTimes(1)
  fireEvent.change(screen.getByLabelText("Supervisor email"), {
    target: { value: "supervisor@example.test" },
  })
  fireEvent.change(screen.getByLabelText("Supervisor password"), {
    target: { value: "Disposable-approval!" },
  })
  fireEvent.change(screen.getByLabelText("Reason for change"), {
    target: { value: "Customer changed their mind" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Approve this change" }))
  await waitFor(() =>
    expect(mocks.saveRegisterBasket).toHaveBeenLastCalledWith([], 1, {
      email: "supervisor@example.test",
      password: "Disposable-approval!",
      reason: "Customer changed their mind",
    })
  )
})

it("keeps an archived saved item removable through supervisor approval", async () => {
  mocks.getRegisterBasket.mockResolvedValue({
    revision: 2,
    lines: [{ product: { ...product, active: false }, quantity: 1 }],
  })
  mocks.quoteBasket.mockRejectedValue(
    new Error("Only active products can be sold")
  )
  render(<SalesScreen staffRole="cashier" />)
  const remove = await screen.findByRole("button", { name: /Remove Rice 10kg/ })
  await waitFor(() => expect(remove.hasAttribute("disabled")).toBe(false))
  expect(
    await screen.findByText("Only active products can be sold")
  ).toBeTruthy()
  fireEvent.click(remove)
  expect(await screen.findByRole("dialog")).toBeTruthy()
  fireEvent.change(screen.getByLabelText("Supervisor email"), {
    target: { value: "supervisor@example.test" },
  })
  fireEvent.change(screen.getByLabelText("Supervisor password"), {
    target: { value: "Disposable-approval!" },
  })
  fireEvent.change(screen.getByLabelText("Reason for change"), {
    target: { value: "Product archived while basket held" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Approve this change" }))
  await waitFor(() =>
    expect(mocks.saveRegisterBasket).toHaveBeenLastCalledWith([], 2, {
      email: "supervisor@example.test",
      password: "Disposable-approval!",
      reason: "Product archived while basket held",
    })
  )
  expect(await screen.findByText("Basket is empty")).toBeTruthy()
})

it("disables sold-out products and stops adding at the available stock", async () => {
  mocks.getProducts.mockResolvedValue({
    products: [{ ...product, availableQuantityMinor: "0" }],
    hasMore: false,
  })
  const view = render(<SalesScreen />)
  const unavailable = await screen.findByRole("button", { name: /Rice 10kg/ })
  await waitFor(() => expect(unavailable).toHaveProperty("disabled", true))
  expect(screen.getByText("Out of stock")).toBeTruthy()
  fireEvent.click(unavailable)
  expect(mocks.saveRegisterBasket).not.toHaveBeenCalled()
  view.unmount()
  mocks.getProducts.mockResolvedValue({
    products: [{ ...product, availableQuantityMinor: "1" }],
    hasMore: false,
  })
  render(<SalesScreen />)
  const lastItem = await screen.findByRole("button", { name: /Rice 10kg/ })
  await waitFor(() => expect(lastItem).toHaveProperty("disabled", false))
  fireEvent.click(lastItem)
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Increase Rice 10kg" })
    ).toHaveProperty("disabled", true)
  )
  expect(lastItem).toHaveProperty("disabled", true)
  expect(screen.getByText("All available stock in basket")).toBeTruthy()
})

it("caps fractional stock in exact minor units and blocks unknown availability", async () => {
  mocks.getProducts.mockResolvedValue({
    products: [{ ...product, unit: "kg", availableQuantityMinor: "1" }],
    hasMore: false,
  })
  const view = render(<SalesScreen />)
  const item = await screen.findByRole("button", { name: /Rice 10kg/ })
  await waitFor(() => expect(item).toHaveProperty("disabled", false))
  fireEvent.click(item)
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Increase Rice 10kg" })
    ).toHaveProperty("disabled", true)
  )
  expect(mocks.saveRegisterBasket).toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ quantity: 0.001 })]),
    expect.any(Number),
    undefined
  )
  view.unmount()
  mocks.getProducts.mockResolvedValue({
    products: [{ ...product, availableQuantityMinor: undefined }],
    hasMore: false,
  })
  render(<SalesScreen />)
  expect(
    await screen.findByRole("button", { name: /Rice 10kg/ })
  ).toHaveProperty("disabled", true)
  expect(
    await screen.findByText("Stock unavailable; refresh products")
  ).toBeTruthy()
})

it("blocks checkout for a restored basket that exceeds refreshed stock", async () => {
  mocks.getProducts.mockResolvedValue({
    products: [{ ...product, availableQuantityMinor: "1" }],
    hasMore: false,
  })
  mocks.getRegisterBasket.mockResolvedValue({
    revision: 1,
    lines: [{ product, quantity: 2 }],
  })
  render(<SalesScreen />)
  expect(await screen.findByText(/Check stock for Rice 10kg/)).toBeTruthy()
  expect(screen.getByRole("button", { name: "Complete sale" })).toHaveProperty(
    "disabled",
    true
  )
  expect(
    screen.getByRole("button", { name: "Increase Rice 10kg" })
  ).toHaveProperty("disabled", true)
  expect(mocks.checkoutCashSale).not.toHaveBeenCalled()
})

it("explains when stocked products are disabled by workspace setup and enables them after basket recovery", async () => {
  mocks.getProducts.mockResolvedValue({
    products: [{ ...product, availableQuantityMinor: "5" }],
    hasMore: false,
  })
  mocks.getRegisterBasket.mockRejectedValueOnce(
    new Error("Select a department and till before starting this operation.")
  )
  const chooseWorkspace = vi.fn()
  render(<SalesScreen onSelectWorkspace={chooseWorkspace} />)
  expect(await screen.findByText("Register unavailable")).toBeTruthy()
  const tile = screen.getByRole("button", { name: /Rice 10kg/ })
  expect(tile).toHaveProperty("disabled", true)
  expect(screen.getByText("5 each in stock")).toBeTruthy()
  expect(screen.queryByText("Out of stock")).toBeNull()
  fireEvent.click(
    screen.getByRole("button", { name: "Choose department & till" })
  )
  expect(chooseWorkspace).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole("button", { name: "Reload saved basket" }))
  await waitFor(() => expect(tile).toHaveProperty("disabled", false))
  expect(screen.queryByText("Register unavailable")).toBeNull()
  fireEvent.click(tile)
  await waitFor(() => expect(mocks.saveRegisterBasket).toHaveBeenCalledOnce())
})
