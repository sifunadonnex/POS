import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { ReportsScreen } from "./reports-screen"

vi.mock("./sales-insights-screen", () => ({
  SalesInsightsScreen: () => <p>Sales report content</p>,
}))
vi.mock("./purchase-reconciliation-screen", () => ({
  PurchaseReconciliationScreen: () => <p>Purchases report content</p>,
}))
vi.mock("./stock-position-screen", () => ({
  StockPositionScreen: () => <p>Stock report content</p>,
}))
vi.mock("./store-documents-screen", () => ({
  StoreDocumentsScreen: () => <p>Documents report content</p>,
}))
afterEach(cleanup)

it("shows only the selected report with accessible tab and panel relationships", () => {
  render(<ReportsScreen />)
  expect(
    screen
      .getByRole("tab", { name: "Sales insights" })
      .getAttribute("aria-selected")
  ).toBe("true")
  expect(screen.getByRole("tabpanel").textContent).toContain(
    "Sales report content"
  )
  fireEvent.click(screen.getByRole("tab", { name: "Stock position" }))
  expect(screen.queryByText("Sales report content")).toBeNull()
  expect(screen.getByRole("tabpanel").textContent).toContain(
    "Stock report content"
  )
  expect(
    screen
      .getByRole("tab", { name: "Stock position" })
      .getAttribute("aria-selected")
  ).toBe("true")
})
