import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { StaffAdminScreen } from "./staff-admin-screen"

const request = vi.hoisted(() => vi.fn())
vi.mock("./identity-api", () => ({ identityRequest: request }))
const account = {
  id: "cashier-id",
  name: "Test Cashier",
  email: "cashier@example.test",
  role: "cashier",
  disabled: false,
  emailVerified: true,
  twoFactorEnabled: false,
  revision: 3,
}
beforeEach(() => {
  request.mockResolvedValue({ staff: [account], hasMore: false })
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it("sends the selected account revision and confirmation, and clears the password after a rejected change", async () => {
  render(<StaffAdminScreen currentUserId="manager-id" />)
  fireEvent.click(
    await screen.findByRole("button", { name: "Manage Test Cashier" })
  )
  const dialog = within(screen.getByRole("dialog"))
  fireEvent.click(dialog.getByRole("button", { name: "Suspended" }))
  fireEvent.change(dialog.getByLabelText("Reason for this action"), {
    target: { value: "Account no longer used" },
  })
  const password = dialog.getByLabelText<HTMLInputElement>(
    "Your current password"
  )
  fireEvent.change(password, { target: { value: "test-only-admin-password" } })
  request.mockRejectedValueOnce(
    new Error("This account changed. Reload before editing")
  )
  fireEvent.click(dialog.getByRole("button", { name: "Save account" }))
  expect(await dialog.findByRole("alert")).toHaveProperty(
    "textContent",
    "This account changed. Reload before editing"
  )
  expect(request).toHaveBeenLastCalledWith(
    "staff/cashier-id",
    {
      password: "test-only-admin-password",
      reason: "Account no longer used",
      name: "Test Cashier",
      role: "cashier",
      disabled: true,
      revision: 3,
    },
    "PATCH"
  )
  expect(password.value).toBe("")
  expect(screen.queryByText("Staff account updated.")).toBeNull()
})

it("requests a recovery link without sending an account update or claiming delivery", async () => {
  render(<StaffAdminScreen currentUserId="manager-id" />)
  fireEvent.click(
    await screen.findByRole("button", { name: "Manage Test Cashier" })
  )
  fireEvent.change(screen.getByLabelText("Reason for this action"), {
    target: { value: "Staff password recovery" },
  })
  fireEvent.change(screen.getByLabelText("Your current password"), {
    target: { value: "test-only-admin-password" },
  })
  request.mockResolvedValueOnce({ status: true })
  fireEvent.click(
    screen.getByRole("button", { name: "Request password-setup link" })
  )
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("staff/cashier-id/send-reset", {
      password: "test-only-admin-password",
      reason: "Staff password recovery",
    })
  )
  expect(
    await screen.findByText(
      "Email link requested. Delivery is recorded in security history."
    )
  ).toBeTruthy()
  expect(request.mock.calls.some((call) => call[2] === "PATCH")).toBe(false)
})

it("prevents self-suspension, self-demotion and self MFA reset in the form", async () => {
  request.mockResolvedValue({
    staff: [
      {
        ...account,
        id: "manager-id",
        name: "Test Manager",
        role: "manager",
        twoFactorEnabled: true,
      },
    ],
    hasMore: false,
  })
  render(<StaffAdminScreen currentUserId="manager-id" />)
  fireEvent.click(
    await screen.findByRole("button", { name: "Manage Test Manager" })
  )
  for (const name of ["Suspended", "Cashier", "Reset authenticator"])
    expect(screen.getByRole("button", { name })).toHaveProperty(
      "disabled",
      true
    )
})

it("confirms removal with the selected revision and offers a removed-staff view", async () => {
  render(<StaffAdminScreen currentUserId="manager-id" />)
  fireEvent.click(
    await screen.findByRole("button", { name: "Manage Test Cashier" })
  )
  expect(screen.getByRole("dialog")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Remove staff account" }))
  expect(
    request.mock.calls.some((call) => String(call[0]).endsWith("/archive"))
  ).toBe(false)
  fireEvent.change(screen.getByLabelText("Reason for this action"), {
    target: { value: "Staff member left" },
  })
  fireEvent.change(screen.getByLabelText("Your current password"), {
    target: { value: "test-only-admin-password" },
  })
  request.mockResolvedValueOnce({ status: true })
  fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("staff/cashier-id/archive", {
      password: "test-only-admin-password",
      reason: "Staff member left",
      revision: 3,
    })
  )
  expect(
    await screen.findByText(
      "Staff account removed. Sign-in is disabled; sales and audit history are retained."
    )
  ).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Removed" }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("staff?search=&page=0&status=removed")
  )
})

it("restores removed accounts as suspended and hides other actions", async () => {
  request.mockResolvedValue({
    staff: [{ ...account, disabled: true, archived: true }],
    hasMore: false,
  })
  render(<StaffAdminScreen currentUserId="manager-id" />)
  fireEvent.click(
    await screen.findByRole("button", { name: "Manage Test Cashier" })
  )
  expect(screen.queryByRole("button", { name: "Save account" })).toBeNull()
  expect(
    screen.queryByRole("button", { name: "Request password-setup link" })
  ).toBeNull()
  fireEvent.change(screen.getByLabelText("Reason for this action"), {
    target: { value: "Staff returning" },
  })
  fireEvent.change(screen.getByLabelText("Your current password"), {
    target: { value: "test-only-admin-password" },
  })
  request.mockResolvedValueOnce({ status: true })
  fireEvent.click(screen.getByRole("button", { name: "Restore as suspended" }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("staff/cashier-id/restore", {
      password: "test-only-admin-password",
      reason: "Staff returning",
      revision: 3,
    })
  )
})
