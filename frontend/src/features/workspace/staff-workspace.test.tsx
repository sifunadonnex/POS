import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { StaffWorkspace } from "./staff-workspace"

vi.mock("./dashboard-screen", () => ({
  DashboardScreen: () => <p>Dashboard workspace</p>,
}))
vi.mock("./sales-screen", () => ({
  SalesScreen: () => <p>Register workspace</p>,
}))

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
  expect(screen.getByText("Amina Manager", { exact: true })).toBeTruthy()
  expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy()
  expect(screen.getByRole("button", { name: "Open register" })).toBeTruthy()
  expect(document.title).toBe("Dashboard — Pay & Go")

  fireEvent.click(screen.getAllByRole("button", { name: "Sales register" })[0])

  expect(screen.getByText("Register workspace")).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Open register" })).toBeNull()
  expect(document.title).toBe("Sales register — Pay & Go")
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }))
  expect(signOut).toHaveBeenCalledOnce()
})
