import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { SalesInsightsScreen } from "./sales-insights-screen"

const mocks = vi.hoisted(() => ({
  getSalesInsights: vi.fn(),
}))

vi.mock("./reports-api", async (original) => ({
  ...(await original<typeof import("./reports-api")>()),
  getSalesInsights: mocks.getSalesInsights,
}))

const report = {
  from: "2026-09-15",
  to: "2026-09-28",
  days: 14,
  summary: {
    saleCount: 4,
    grossSalesMinor: 26000,
    refundCount: 1,
    refundMinor: 2000,
    netSalesMinor: 24000,
    averageBasketMinor: 6500,
    activeCashierCount: 2,
  },
  daily: [
    {
      day: "2026-09-27",
      saleCount: 1,
      grossSalesMinor: 6000,
      refundMinor: 0,
      netSalesMinor: 6000,
    },
    {
      day: "2026-09-28",
      saleCount: 3,
      grossSalesMinor: 20000,
      refundMinor: 2000,
      netSalesMinor: 18000,
    },
  ],
  cashiers: [
    {
      cashierId: "cashier-1",
      cashierName: "Amina Cashier",
      saleCount: 3,
      grossSalesMinor: 20000,
      refundMinor: 2000,
      netSalesMinor: 18000,
      averageBasketMinor: 6667,
    },
  ],
  paymentMix: [
    { kind: "cash", paymentCount: 3, amountMinor: 18000 },
    { kind: "mpesa", paymentCount: 1, amountMinor: 8000 },
  ],
  topProducts: [
    {
      productId: "product-1",
      productName: "Premium flour",
      unit: "each",
      quantityMinor: 4,
      grossSalesMinor: 12000,
      saleCount: 3,
    },
  ],
}

beforeEach(() => {
  mocks.getSalesInsights.mockResolvedValue(report)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it("shows daily sales, cashier, payment and product insights", async () => {
  render(<SalesInsightsScreen />)

  expect(await screen.findByText("Net sales")).toBeTruthy()
  expect(screen.getByText("Daily sales")).toBeTruthy()
  expect(screen.getByText("Sales by cashier")).toBeTruthy()
  expect(screen.getByText("Amina Cashier")).toBeTruthy()
  expect(screen.getByText("Payment mix")).toBeTruthy()
  expect(screen.getByText("Premium flour")).toBeTruthy()
  expect(screen.getByText(/240\.00/)).toBeTruthy()
})

it("rejects an inverted reporting range before another request", async () => {
  render(<SalesInsightsScreen />)
  await screen.findByText("Net sales")

  fireEvent.change(screen.getByLabelText("From"), {
    target: { value: "2026-09-29" },
  })
  fireEvent.change(screen.getByLabelText("To"), {
    target: { value: "2026-09-01" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Run report" }))

  expect(screen.getByText("Choose a valid start and end date.")).toBeTruthy()
  expect(mocks.getSalesInsights).toHaveBeenCalledOnce()
})
