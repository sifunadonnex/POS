import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ValuationPanel } from "./valuation-panel"

const mocks = vi.hoisted(() => ({
  getValuation: vi.fn(),
  saveOpeningValuation: vi.fn(),
}))
vi.mock("./valuation-api", () => mocks)
const response = {
  products: [
    {
      productId: "product-1",
      name: "Sample stock",
      sku: "SAMPLE",
      unit: "each",
      quantityMinor: "3",
      valueMinor: null,
      departmentLabel: "Branch · Minimart",
    },
  ],
  departments: [
    {
      departmentId: "department-1",
      label: "Branch · Minimart",
      stockValueMinor: "0",
      unvaluedProducts: 1,
      netSalesMinor: "1000",
      netCostMinor: "0",
      missingCostLines: 1,
      grossProfitMinor: null,
    },
  ],
}
beforeEach(() => {
  mocks.getValuation.mockResolvedValue(response)
  mocks.saveOpeningValuation.mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it("keeps unknown costs visible and withholds incomplete gross profit", async () => {
  render(<ValuationPanel />)
  expect(await screen.findByText("Awaiting cost records")).toBeTruthy()
  expect(screen.getByText("Incomplete")).toBeTruthy()
  expect(screen.getByText(/1 sale\/return lines/)).toBeTruthy()
  expect(
    screen.queryByRole("button", { name: "Save opening valuation" })
  ).toBeNull()
})
it("retries an unconfirmed opening value with the original request and exact minor units", async () => {
  mocks.saveOpeningValuation.mockRejectedValueOnce(
    new Error("Connection lost. Retry the same request.")
  )
  render(<ValuationPanel allowOpening />)
  await screen.findByText("Branch · Minimart", { selector: "h3" })
  fireEvent.click(screen.getByRole("combobox", { name: "Unvalued product" }))
  fireEvent.click(await screen.findByRole("option", { name: /SAMPLE/ }))
  fireEvent.change(screen.getByLabelText("Total stock value (KES)"), {
    target: { value: "12.34" },
  })
  fireEvent.change(screen.getByLabelText("Valuation reason / reference"), {
    target: { value: "Reviewed opening invoice" },
  })
  fireEvent.click(
    screen.getByRole("button", { name: "Save opening valuation" })
  )
  await screen.findByText("Connection lost. Retry the same request.")
  fireEvent.click(
    screen.getByRole("button", { name: "Retry same opening valuation" })
  )
  await screen.findByText("Opening stock value saved.")
  expect(mocks.saveOpeningValuation).toHaveBeenCalledTimes(2)
  expect(mocks.saveOpeningValuation.mock.calls[0][0]).toEqual(
    mocks.saveOpeningValuation.mock.calls[1][0]
  )
  expect(mocks.saveOpeningValuation.mock.calls[0][0]).toMatchObject({
    productId: "product-1",
    expectedQuantityMinor: "3",
    totalValueMinor: "1234",
    reason: "Reviewed opening invoice",
  })
})
it("recovers a failed valuation read through reload", async () => {
  mocks.getValuation.mockRejectedValueOnce(new Error("Database unavailable"))
  render(<ValuationPanel />)
  await screen.findByText("Database unavailable")
  fireEvent.click(screen.getByRole("button", { name: "Reload valuation" }))
  await waitFor(() =>
    expect(screen.queryByText("Database unavailable")).toBeNull()
  )
  expect(await screen.findByText("Awaiting cost records")).toBeTruthy()
})
