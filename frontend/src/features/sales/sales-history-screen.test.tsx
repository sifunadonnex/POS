import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { SalesHistoryScreen } from "./sales-history-screen"

const mocks = vi.hoisted(() => ({
  getSalesLedger: vi.fn(),
  getSaleDetail: vi.fn(),
}))

vi.mock("./sales-api", async (original) => ({
  ...(await original<typeof import("./sales-api")>()),
  ...mocks,
}))

const sale = {
  saleId: "11111111-1111-4111-8111-111111111111",
  cashierId: "cashier-1",
  cashierName: "Local Cashier",
  totalMinor: 1250,
  paidMinor: 1250,
  refundedMinor: 250,
  balanceMinor: 0,
  lineCount: 1,
  paymentKinds: ["cash"] as const,
  paymentStatus: "paid" as const,
  createdAt: "2026-09-21T08:00:00.000Z",
}

beforeEach(() => {
  mocks.getSalesLedger.mockResolvedValue({ sales: [sale], hasMore: false })
  mocks.getSaleDetail.mockResolvedValue({
    ...sale,
    lines: [
      {
        productId: "22222222-2222-4222-8222-222222222222",
        name: "Rice",
        sku: "RICE",
        unit: "each",
        quantity: 1,
        unitPriceMinor: 1250,
        lineTotalMinor: 1250,
      },
    ],
    payments: [
      {
        paymentId: "33333333-3333-4333-8333-333333333333",
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
  vi.resetAllMocks()
})

it("shows payment and refund status and drills into a sale", async () => {
  render(<SalesHistoryScreen />)

  expect(await screen.findByText("Sale 11111111")).toBeTruthy()
  expect(screen.getByText("Paid")).toBeTruthy()
  expect(screen.getByText("Refunded")).toBeTruthy()

  fireEvent.click(screen.getByRole("button", { name: /Sale 11111111/ }))

  await waitFor(() =>
    expect(mocks.getSaleDetail).toHaveBeenCalledWith(sale.saleId)
  )
  expect(await screen.findByText("Rice")).toBeTruthy()
  expect(screen.getByText(/change KES 7.50/)).toBeTruthy()
})

it("rejects an inverted date range before requesting it", async () => {
  render(<SalesHistoryScreen />)
  await screen.findByText("Sale 11111111")
  mocks.getSalesLedger.mockClear()

  fireEvent.change(screen.getByLabelText("From"), {
    target: { value: "2026-09-30" },
  })
  fireEvent.change(screen.getByLabelText("To"), {
    target: { value: "2026-09-01" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Apply" }))

  expect((await screen.findByRole("alert")).textContent).toContain(
    "Start date must be before"
  )
  expect(mocks.getSalesLedger).not.toHaveBeenCalled()
})
