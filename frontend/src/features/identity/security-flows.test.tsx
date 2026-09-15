import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { RecoveryScreen } from "./recovery-screen"
import { readRecoveryLink } from "./recovery-link"
import { MfaScreen } from "./mfa-screen"
import { LoginForm } from "./login-form"
import { IdentityScreen } from "./identity-screen"
vi.mock("../catalogue/catalogue-screen", () => ({
  CatalogueScreen: () => <p>Product catalogue</p>,
}))

const mocks = vi.hoisted(() => ({
  resetPassword: vi.fn(),
  verifyEmail: vi.fn(),
  requestPasswordReset: vi.fn(),
  sendVerificationEmail: vi.fn(),
  enable: vi.fn(),
  verifyTotp: vi.fn(),
  verifyBackupCode: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  getStaff: vi.fn(),
  identityRequest: vi.fn(),
}))
vi.mock("./auth-client", () => ({
  authClient: {
    resetPassword: mocks.resetPassword,
    verifyEmail: mocks.verifyEmail,
    requestPasswordReset: mocks.requestPasswordReset,
    sendVerificationEmail: mocks.sendVerificationEmail,
    twoFactor: {
      enable: mocks.enable,
      verifyTotp: mocks.verifyTotp,
      verifyBackupCode: mocks.verifyBackupCode,
    },
    signIn: { email: mocks.signIn },
    signOut: mocks.signOut,
  },
}))
vi.mock("./identity-api", () => ({
  getStaff: mocks.getStaff,
  identityRequest: mocks.identityRequest,
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.useRealTimers()
  window.history.replaceState(null, "", "/")
})

it("treats a login MFA challenge as incomplete authentication", async () => {
  mocks.signIn.mockResolvedValue({
    data: { twoFactorRedirect: true },
    error: null,
  })
  const signedIn = vi.fn(),
    challenge = vi.fn()
  render(<LoginForm onSignedIn={signedIn} onMfaRequired={challenge} />)
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "manager@example.test" },
  })
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "test-password-123" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
  await waitFor(() => expect(challenge).toHaveBeenCalledOnce())
  expect(signedIn).not.toHaveBeenCalled()
})

it("does not claim a password reset succeeded when the token is rejected", async () => {
  mocks.resetPassword.mockResolvedValue({ error: { status: 400 } })
  render(
    <RecoveryScreen
      recovery={{ purpose: "reset", token: "invalid-test-token" }}
      onBack={vi.fn()}
    />
  )
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "new-test-password" },
  })
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: "new-test-password" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Change password" }))
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("Request a new link")
  )
  expect(screen.queryByRole("status")).toBeNull()
})

it("requires an explicit email verification action before using a link", async () => {
  mocks.verifyEmail.mockResolvedValue({ error: null })
  render(
    <RecoveryScreen
      recovery={{ purpose: "verify", token: "test-token" }}
      onBack={vi.fn()}
    />
  )
  expect(mocks.verifyEmail).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Verify email" }))
  expect(await screen.findByRole("status")).toHaveProperty(
    "textContent",
    expect.stringContaining("Email verified")
  )
})

it("extracts recovery tokens without changing the URL during render", () => {
  window.history.replaceState(null, "", "/#reset=test-token")
  expect(readRecoveryLink()).toEqual({ purpose: "reset", token: "test-token" })
  expect(window.location.hash).toBe("#reset=test-token")
})

it("requires recovery-code acknowledgement and a successful authenticator code before finishing enrollment", async () => {
  mocks.enable.mockResolvedValue({
    error: null,
    data: {
      totpURI: "otpauth://totp/PayGo?secret=JBSWY3DPEHPK3PXP",
      backupCodes: ["test-code-one", "test-code-two"],
    },
  })
  mocks.verifyTotp
    .mockResolvedValueOnce({ error: { status: 401 } })
    .mockResolvedValueOnce({ error: null })
  const verified = vi.fn()
  render(<MfaScreen enrollment onVerified={verified} />)
  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "test-password-123" },
  })
  fireEvent.click(
    screen.getByRole("button", { name: "Start authenticator setup" })
  )
  await screen.findByText("Save your recovery codes")
  expect(
    screen.getByRole("button", { name: "Verify code" }).hasAttribute("disabled")
  ).toBe(true)
  fireEvent.click(
    screen.getByRole("button", { name: "I saved my recovery codes" })
  )
  fireEvent.change(screen.getByLabelText("Authenticator code"), {
    target: { value: "123456" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Verify code" }))
  await screen.findByRole("alert")
  expect(verified).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Verify code" }))
  await waitFor(() => expect(verified).toHaveBeenCalledOnce())
  expect(mocks.verifyTotp).toHaveBeenLastCalledWith({
    code: "123456",
    trustDevice: false,
  })
})

it("hides manager tools until the server confirms MFA", async () => {
  mocks.getStaff.mockResolvedValue({
    id: "manager",
    name: "Manager",
    email: "manager@example.test",
    role: "manager",
    emailVerified: true,
    twoFactorEnabled: false,
    mfaRequired: true,
    idleSeconds: 900,
  })
  render(<IdentityScreen />)
  await screen.findByText("Set up your authenticator")
  expect(screen.queryByRole("button", { name: "Staff accounts" })).toBeNull()
  expect(screen.queryByRole("button", { name: "Security history" })).toBeNull()
})

it("locks idle content even when logout cannot reach the server", async () => {
  vi.useFakeTimers()
  mocks.getStaff.mockResolvedValue({
    id: "cashier",
    name: "Cashier",
    email: "cashier@example.test",
    role: "cashier",
    emailVerified: true,
    twoFactorEnabled: false,
    mfaRequired: false,
    idleSeconds: 60,
  })
  mocks.signOut.mockRejectedValue(new Error("offline"))
  render(<IdentityScreen />)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(screen.getByText("Welcome, Cashier")).toBeTruthy()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000)
  })
  expect(screen.queryByText("Welcome, Cashier")).toBeNull()
  expect(screen.getByText("Your screen is locked")).toBeTruthy()
  expect(screen.getByRole("alert").textContent).toContain(
    "could not be confirmed"
  )
  expect(mocks.identityRequest).not.toHaveBeenCalled()
})
