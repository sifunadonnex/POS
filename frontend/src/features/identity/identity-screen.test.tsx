import { afterEach, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { IdentityScreen } from "./identity-screen"

const { getStaff, signOut } = vi.hoisted(() => ({
  getStaff: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock("./identity-api", () => ({ getStaff, identityRequest: vi.fn() }))
vi.mock("../catalogue/catalogue-screen", () => ({
  CatalogueScreen: () => <p>Product catalogue</p>,
}))
vi.mock("../sync/use-runtime-status", () => ({
  useRuntimeStatus: () => ({
    status: "ready",
    value: {
      mode: "hosted",
      storeId: null,
      checkoutAuthority: "hosted",
      syncConfigured: false,
      pendingEvents: 0,
      oldestPendingAt: null,
    },
  }),
}))
vi.mock("./auth-client", () => ({
  authClient: { signOut, signIn: { email: vi.fn() } },
}))
const staff = {
  id: "1",
  name: "Test Manager",
  email: "manager@example.test",
  role: "manager",
  emailVerified: true,
  twoFactorEnabled: true,
  mfaRequired: false,
  idleSeconds: 900,
}
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it("shows session loading and then the sign-in form", async () => {
  getStaff.mockResolvedValue(null)
  render(<IdentityScreen />)
  expect(screen.getByRole("status").textContent).toContain("Checking")
  expect(await screen.findByLabelText("Email")).toBeTruthy()
  expect(screen.getByText("Every shift starts with a clear view.")).toBeTruthy()
})

it("preserves typed credentials when returning to the signed-out tab", async () => {
  getStaff.mockResolvedValue(null)
  render(<IdentityScreen />)
  const email = await screen.findByLabelText("Email")
  fireEvent.change(email, { target: { value: "cashier@example.test" } })
  fireEvent(window, new Event("focus"))
  await waitFor(() => expect(getStaff).toHaveBeenCalledTimes(2))
  expect(screen.getByLabelText("Email")).toBe(email)
  expect(screen.getByDisplayValue("cashier@example.test")).toBeTruthy()
})

it("shows an outage with retry instead of protected content", async () => {
  getStaff
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(staff)
  render(<IdentityScreen />)
  expect((await screen.findByRole("alert")).textContent).toContain(
    "cannot verify"
  )
  expect(screen.queryByText("Test Manager", { exact: true })).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Retry" }))
  expect(await screen.findByText("Test Manager", { exact: true })).toBeTruthy()
  expect(document.title).toBe("Dashboard — Pay & Go")
})

it("removes protected content when the session expires", async () => {
  getStaff.mockResolvedValueOnce(staff).mockResolvedValue(null)
  render(<IdentityScreen />)
  expect(await screen.findByText("Test Manager", { exact: true })).toBeTruthy()
  fireEvent(window, new Event("focus"))
  expect(await screen.findByLabelText("Email")).toBeTruthy()
  expect(screen.queryByText("Test Manager", { exact: true })).toBeNull()
})

it("keeps the workspace open when the local API remains reachable offline", async () => {
  getStaff.mockResolvedValue(staff)
  render(<IdentityScreen />)
  expect(await screen.findByText("Test Manager", { exact: true })).toBeTruthy()

  fireEvent(window, new Event("offline"))

  await waitFor(() => expect(getStaff).toHaveBeenCalledTimes(2))
  expect(screen.getByText("Test Manager", { exact: true })).toBeTruthy()
})

it("does not claim a failed logout succeeded and permits retry", async () => {
  getStaff.mockResolvedValue(staff)
  signOut
    .mockResolvedValueOnce({ error: { status: 503 } })
    .mockResolvedValueOnce({ error: null })
  render(<IdentityScreen />)
  await screen.findByText("Test Manager", { exact: true })
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }))
  expect((await screen.findByRole("alert")).textContent).toContain(
    "could not be confirmed"
  )
  expect(screen.queryByLabelText("Email")).toBeNull()
  getStaff.mockResolvedValue(null)
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }))
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
  expect(await screen.findByLabelText("Email")).toBeTruthy()
})
