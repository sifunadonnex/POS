import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { DailySummaryDialog } from "./daily-summary-dialog"
const getSummary = vi.hoisted(() => vi.fn())
vi.mock("../reports/reports-api", () => ({ getDailySummary: getSummary }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
it("loads a chosen trading date and keeps failed summaries retryable", async () => {
  getSummary.mockRejectedValueOnce(new Error("Service unavailable"))
  render(<DailySummaryDialog />)
  expect(getSummary).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Daily summary" }))
  expect(await screen.findByRole("dialog")).toBeTruthy()
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("Service unavailable")
  )
  getSummary.mockResolvedValue({
    saleCount: 2,
    salesTotalMinor: 5000,
    cashMinor: 5000,
    cardMinor: 0,
    mpesaMinor: 0,
    refundMinor: 1000,
    closedShiftCount: 1,
    varianceMinor: 0,
  })
  fireEvent.click(screen.getByRole("button", { name: "Retry" }))
  expect(await screen.findByText("Net sales after refunds")).toBeTruthy()
  expect(screen.getByText("KES 40.00")).toBeTruthy()
  fireEvent.change(screen.getByLabelText("Trading date"), {
    target: { value: "2026-10-15" },
  })
  expect(getSummary).toHaveBeenLastCalledWith(
    "2026-10-15",
    expect.any(AbortSignal)
  )
})
