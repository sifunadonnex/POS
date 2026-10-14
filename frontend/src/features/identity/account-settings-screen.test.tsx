import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { AccountSettingsScreen } from "./account-settings-screen"

const mocks = vi.hoisted(() => ({
  changePassword: vi.fn(),
  generateBackupCodes: vi.fn(),
  setTheme: vi.fn(),
}))
vi.mock("./auth-client", () => ({
  authClient: {
    changePassword: mocks.changePassword,
    twoFactor: { generateBackupCodes: mocks.generateBackupCodes },
  },
}))
vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ theme: "system", setTheme: mocks.setTheme }),
}))
const staff = {
  id: "test-staff",
  name: "Test Manager",
  email: "manager@example.test",
  role: "manager" as const,
  emailVerified: true,
  twoFactorEnabled: true,
  mfaRequired: false,
  idleSeconds: 900,
}
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it("shows server profile details and applies an appearance preference through the theme provider", () => {
  render(<AccountSettingsScreen staff={staff} onChanged={vi.fn()} />)
  expect(screen.getByText("Full name")).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Save profile" })).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Appearance" }))
  expect(
    screen.getByRole("button", { name: /System/ }).getAttribute("aria-pressed")
  ).toBe("true")
  fireEvent.click(screen.getByRole("button", { name: /Dark/ }))
  expect(mocks.setTheme).toHaveBeenCalledWith("dark")
})

it("changes a password with session revocation and only reports success after confirmation", async () => {
  let finish: (value: { error: null }) => void = () => undefined
  mocks.changePassword.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const changed = vi.fn()
  render(<AccountSettingsScreen staff={staff} onChanged={changed} />)
  fireEvent.click(screen.getByRole("button", { name: "Security" }))
  const form = screen.getByRole("form", { name: "Change password" })
  fireEvent.change(form.querySelector("#current-password")!, {
    target: { value: "old-test-password" },
  })
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "new-test-password" },
  })
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: "new-test-password" },
  })
  fireEvent.submit(form)
  fireEvent.submit(form)
  expect(mocks.changePassword).toHaveBeenCalledOnce()
  expect(mocks.changePassword).toHaveBeenCalledWith({
    currentPassword: "old-test-password",
    newPassword: "new-test-password",
    revokeOtherSessions: true,
  })
  expect(screen.queryByRole("status")).toBeNull()
  finish({ error: null })
  await waitFor(() => expect(changed).toHaveBeenCalledOnce())
  expect(screen.getByRole("status").textContent).toContain("Password changed")
})

it("does not show replacement recovery codes when generation fails", async () => {
  mocks.generateBackupCodes.mockResolvedValue({ error: { status: 401 } })
  render(<AccountSettingsScreen staff={staff} onChanged={vi.fn()} />)
  fireEvent.click(screen.getByRole("button", { name: "Security" }))
  fireEvent.change(
    screen.getByLabelText("Current password", { selector: "#backup-password" }),
    { target: { value: "wrong-test-password" } }
  )
  fireEvent.click(
    screen.getByRole("button", { name: "Generate new recovery codes" })
  )
  expect((await screen.findByRole("alert")).textContent).toContain(
    "could not be regenerated"
  )
  expect(screen.queryByText("I saved these codes")).toBeNull()
})
