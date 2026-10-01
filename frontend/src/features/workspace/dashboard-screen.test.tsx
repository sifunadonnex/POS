import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { DashboardScreen } from "./dashboard-screen"

const mocks = vi.hoisted(() => ({
  getDailySummary: vi.fn(),
  getSalesInsights: vi.fn(),
}))

vi.mock("../reports/reports-api", async (original) => ({
  ...(await original<typeof import("../reports/reports-api")>()),
  getDailySummary: mocks.getDailySummary,
  getSalesInsights: mocks.getSalesInsights,
}))

const summary = {
  day: "2026-09-22",
  saleCount: 8,
  salesTotalMinor: 2345000,
  paymentCount: 8,
  cashMinor: 1845000,
  cardMinor: 0,
  mpesaMinor: 500000,
  refundCount: 1,
  refundMinor: 12500,
  closedShiftCount: 2,
  varianceMinor: 0,
  lowStockCount: 3,
  lowStockItems: [
    {
      productId: "product-1",
      sku: "RICE",
      name: "Loose rice",
      unit: "kg" as const,
      quantityMinor: 1250,
      thresholdMinor: 2000,
    },
  ],
}

const salesTrend = {
  from: "2026-09-16",
  to: "2026-09-22",
  days: 7,
  summary: {
    saleCount: 18,
    grossSalesMinor: 5345000,
    refundCount: 1,
    refundMinor: 12500,
    netSalesMinor: 5332500,
    averageBasketMinor: 296944,
    activeCashierCount: 2,
  },
  daily: [
    {
      day: "2026-09-16",
      saleCount: 3,
      grossSalesMinor: 900000,
      refundMinor: 0,
      netSalesMinor: 900000,
    },
    {
      day: "2026-09-22",
      saleCount: 8,
      grossSalesMinor: 2345000,
      refundMinor: 12500,
      netSalesMinor: 2332500,
    },
  ],
  cashiers: [],
  paymentMix: [],
  topProducts: [],
}

beforeEach(() => {
  mocks.getDailySummary.mockResolvedValue(summary)
  mocks.getSalesInsights.mockResolvedValue(salesTrend)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it("shows live manager operations and navigates to implemented inventory work", async () => {
  const onNavigate = vi.fn()
  render(
    <DashboardScreen
      manager
      staffName="Local Test Manager"
      onNavigate={onNavigate}
    />
  )

  expect(await screen.findByText("Sales collected")).toBeTruthy()
  expect(await screen.findByText("7-day sales pulse")).toBeTruthy()
  expect(screen.getByText("Net sales")).toBeTruthy()
  expect(screen.getByText("Shift reconciliation")).toBeTruthy()
  expect(screen.getByText("Purchase intake")).toBeTruthy()
  expect(screen.getByText("Stocktake")).toBeTruthy()
  expect(screen.getByText("Reports")).toBeTruthy()
  expect(screen.getByText("3")).toBeTruthy()
  expect(screen.getByText("Stock alerts")).toBeTruthy()
  expect(screen.getByText("Loose rice")).toBeTruthy()
  expect(screen.getByText("1.25 kg")).toBeTruthy()

  fireEvent.click(screen.getByRole("button", { name: "Review stock" }))
  expect(onNavigate).toHaveBeenCalledWith("stock")

  fireEvent.click(screen.getByRole("button", { name: "Open stock control" }))
  expect(onNavigate).toHaveBeenCalledWith("stock")

  fireEvent.click(screen.getByRole("button", { name: "Receive goods" }))
  expect(onNavigate).toHaveBeenCalledWith("purchases")
})

it("keeps manager figures private while exposing cashier workflows", () => {
  const onNavigate = vi.fn()
  render(
    <DashboardScreen
      manager={false}
      staffName="Local Test Cashier"
      onNavigate={onNavigate}
    />
  )

  expect(mocks.getDailySummary).not.toHaveBeenCalled()
  expect(mocks.getSalesInsights).not.toHaveBeenCalled()
  expect(screen.getByText("Next customer")).toBeTruthy()
  expect(screen.getByText("Customer service")).toBeTruthy()
  expect(screen.queryByText("Purchase intake")).toBeNull()
  expect(
    screen.getByText(
      "Payment totals and reconciliation are available to managers."
    )
  ).toBeTruthy()

  fireEvent.click(screen.getByRole("button", { name: "Start return" }))
  expect(onNavigate).toHaveBeenCalledWith("returns")
})
