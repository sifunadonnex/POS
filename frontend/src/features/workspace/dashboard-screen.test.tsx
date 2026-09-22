import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { DashboardScreen } from "./dashboard-screen"

const mocks = vi.hoisted(() => ({
  getDailySummary: vi.fn(),
}))

vi.mock("../reports/reports-api", async (original) => ({
  ...(await original<typeof import("../reports/reports-api")>()),
  getDailySummary: mocks.getDailySummary,
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
}

beforeEach(() => {
  mocks.getDailySummary.mockResolvedValue(summary)
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
  expect(screen.getByText("Shift reconciliation")).toBeTruthy()
  expect(screen.getByText("Purchase intake")).toBeTruthy()
  expect(screen.getByText("Stocktake")).toBeTruthy()
  expect(screen.getByText("Purchase reports")).toBeTruthy()
  expect(screen.getByText("3")).toBeTruthy()

  fireEvent.click(screen.getByRole("button", { name: "Review stock" }))
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
