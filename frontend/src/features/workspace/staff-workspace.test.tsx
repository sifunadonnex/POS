import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { StaffWorkspace } from "./staff-workspace"

const useRuntimeStatusMock = vi.hoisted(() => vi.fn())

vi.mock("./dashboard-screen", () => ({
  DashboardScreen: () => <p>Dashboard workspace</p>,
}))
vi.mock("./sales-screen", () => ({
  SalesScreen: () => <p>Register workspace</p>,
}))
vi.mock("../sync/use-runtime-status", () => ({
  useRuntimeStatus: useRuntimeStatusMock,
}))

beforeEach(() => {
  useRuntimeStatusMock.mockReturnValue({
    status: "ready",
    value: {
      mode: "hosted",
      storeId: null,
      checkoutAuthority: "hosted",
      syncConfigured: false,
      pendingEvents: 0,
      oldestPendingAt: null,
      deliveredEvents: 0,
      latestDeliveredAt: null,
      receivedEvents: 0,
      latestReceivedAt: null,
      projectedEvents: 0,
      unprojectedEvents: 0,
    },
  })
})

const staff = {
  id: "manager-1",
  name: "Amina Manager",
  email: "amina@example.test",
  role: "manager" as const,
  emailVerified: true,
  twoFactorEnabled: true,
  mfaRequired: false,
  idleSeconds: 900,
}

afterEach(cleanup)

it("uses a full application shell with contextual actions and session controls", () => {
  const signOut = vi.fn()
  render(
    <StaffWorkspace
      staff={staff}
      signingOut={false}
      onSignOut={signOut}
      onSecurityChanged={vi.fn()}
    />
  )

  expect(screen.getByLabelText("Primary navigation")).toBeTruthy()
  expect(screen.getByLabelText("Mobile navigation")).toBeTruthy()
  expect(
    screen
      .getAllByRole("button", { name: "Dashboard" })[0]
      .getAttribute("aria-current")
  ).toBe("page")
  expect(screen.getByText("Amina Manager", { exact: true })).toBeTruthy()
  expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy()
  expect(screen.getByRole("button", { name: "Open register" })).toBeTruthy()
  expect(screen.getByText("Hosted", { exact: true })).toBeTruthy()
  expect(document.title).toBe("Dashboard — Pay & Go")

  fireEvent.click(screen.getAllByRole("button", { name: "Sales register" })[0])

  expect(screen.getByText("Register workspace")).toBeTruthy()
  expect(
    screen
      .getAllByRole("button", { name: "Sales register" })[0]
      .getAttribute("aria-current")
  ).toBe("page")
  expect(screen.queryByRole("button", { name: "Open register" })).toBeNull()
  expect(document.title).toBe("Sales register — Pay & Go")
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }))
  expect(signOut).toHaveBeenCalledOnce()
})

it("makes a hosted reporting projection gap visible", () => {
  useRuntimeStatusMock.mockReturnValue({
    status: "ready",
    value: {
      mode: "hosted",
      storeId: "11111111-1111-4111-8111-111111111111",
      checkoutAuthority: "hosted",
      syncConfigured: true,
      pendingEvents: 0,
      oldestPendingAt: null,
      deliveredEvents: 0,
      latestDeliveredAt: null,
      receivedEvents: 3,
      latestReceivedAt: "2026-10-02T12:00:00.000Z",
      projectedEvents: 2,
      unprojectedEvents: 1,
    },
  })

  render(
    <StaffWorkspace
      staff={staff}
      signingOut={false}
      onSignOut={vi.fn()}
      onSecurityChanged={vi.fn()}
    />
  )

  expect(screen.getByText("Sync needs attention · 1")).toBeTruthy()
})
