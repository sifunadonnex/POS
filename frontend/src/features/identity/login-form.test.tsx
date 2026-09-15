import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { LoginForm } from "./login-form"

const { signIn } = vi.hoisted(() => ({ signIn: vi.fn() }))
vi.mock("./auth-client", () => ({ authClient: { signIn: { email: signIn } } }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

function fill() {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "cashier@example.test" },
  })
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "test-password-123" },
  })
}

describe("staff login", () => {
  it("submits credentials without remembering a shared till and reports success only after confirmation", async () => {
    let resolve: (value: { error: null }) => void = () => {
      throw new Error("Not initialized")
    }
    signIn.mockReturnValue(
      new Promise((r) => {
        resolve = r
      })
    )
    const success = vi.fn()
    render(<LoginForm onSignedIn={success} />)
    fill()
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
    expect(success).not.toHaveBeenCalled()
    expect(
      screen
        .getByRole("button", { name: "Signing in…" })
        .hasAttribute("disabled")
    ).toBe(true)
    expect(signIn).toHaveBeenCalledOnce()
    expect(signIn).toHaveBeenCalledWith({
      email: "cashier@example.test",
      password: "test-password-123",
      rememberMe: false,
    })
    resolve({ error: null })
    await waitFor(() => expect(success).toHaveBeenCalledOnce())
  })

  it.each([401, 429, 503])(
    "does not claim success on HTTP %s",
    async (status) => {
      signIn.mockResolvedValue({ error: { status } })
      const success = vi.fn()
      render(<LoginForm onSignedIn={success} />)
      fill()
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
      expect(await screen.findByRole("alert")).toBeTruthy()
      expect(success).not.toHaveBeenCalled()
      expect(
        screen.getByRole("button", { name: "Sign in" }).hasAttribute("disabled")
      ).toBe(false)
    }
  )

  it("allows retry after a network failure", async () => {
    signIn
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ error: null })
    const success = vi.fn()
    render(<LoginForm onSignedIn={success} />)
    fill()
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Unable to connect"
    )
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
    await waitFor(() => expect(success).toHaveBeenCalledOnce())
  })
})
