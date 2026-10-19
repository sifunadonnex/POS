import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { BusinessSettings } from "./business-settings"
vi.mock("../inventory/valuation-api", () => ({
  getValuation: async () => ({ products: [], departments: [] }),
}))

const mocks = vi.hoisted(() => ({
  businessRequest: vi.fn(),
  getBusinessConfiguration: vi.fn(),
}))
vi.mock("./business-api", async (original) => ({
  ...(await original<typeof import("./business-api")>()),
  ...mocks,
}))
beforeEach(() => {
  mocks.getBusinessConfiguration.mockResolvedValue({
    departments: [],
    tills: [],
    settings: { revision: 1, expiryWarningDays: null },
  })
  mocks.businessRequest.mockImplementation(async (path: string) =>
    path === "/administration"
      ? { staff: [], assignments: [], unassignedProducts: [], openShifts: [] }
      : {}
  )
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
it("starts with no invented branch or expiry warning and saves the manager's branch name", async () => {
  render(<BusinessSettings />)
  expect(await screen.findByText("No branches configured yet.")).toBeTruthy()
  expect(screen.getByLabelText("Days before expiry")).toHaveProperty(
    "value",
    ""
  )
  fireEvent.change(screen.getByLabelText("Branch name"), {
    target: { value: "Westlands" },
  })
  fireEvent.change(document.getElementById("branch-reason")!, {
    target: { value: "New physical branch" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Add branch" }))
  await waitFor(() =>
    expect(mocks.businessRequest).toHaveBeenCalledWith("/branches", {
      id: expect.any(String),
      name: "Westlands",
      reason: "New physical branch",
    })
  )
  expect(await screen.findByRole("status")).toBeTruthy()
})
it("saves the configured warning window with optimistic concurrency and reports failures", async () => {
  render(<BusinessSettings />)
  const days = await screen.findByLabelText("Days before expiry")
  mocks.businessRequest.mockRejectedValueOnce(
    new Error("Settings changed. Reload before saving.")
  )
  fireEvent.change(days, { target: { value: "14" } })
  fireEvent.change(document.getElementById("expiry-reason")!, {
    target: { value: "Two week stock review" },
  })
  fireEvent.click(
    screen.getByRole("button", { name: "Save expiry warning period" })
  )
  await waitFor(() =>
    expect(mocks.businessRequest).toHaveBeenCalledWith("/settings", {
      expiryWarningDays: 14,
      revision: 1,
      reason: "Two week stock review",
    })
  )
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("Settings changed")
  )
  expect(screen.queryByRole("status")).toBeNull()
})
