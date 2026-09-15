import { useRef, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient } from "./auth-client"
import { PasswordField } from "./security-fields"
import { formText } from "./security-form"
import type { Recovery } from "./recovery-link"

export function RecoveryScreen({
  recovery,
  onBack,
}: {
  recovery: Recovery
  onBack: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState(false)
  const submitting = useRef(false)
  const hasToken = recovery.token !== undefined
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const form = event.currentTarget
    const data = new FormData(form)
    if (
      hasToken &&
      recovery.purpose === "reset" &&
      formText(data, "new-password") !== formText(data, "confirm-password")
    ) {
      setError("The new passwords do not match.")
      return
    }
    submitting.current = true
    setPending(true)
    setError("")
    try {
      const result = hasToken
        ? recovery.purpose === "reset"
          ? await authClient.resetPassword({
              token: recovery.token,
              newPassword: formText(data, "new-password"),
            })
          : await authClient.verifyEmail({
              query: { token: recovery.token ?? "" },
            })
        : recovery.purpose === "reset"
          ? await authClient.requestPasswordReset({
              email: formText(data, "recovery-email").trim(),
            })
          : await authClient.sendVerificationEmail({
              email: formText(data, "recovery-email").trim(),
            })
      if (result.error) {
        setError(
          result.error.status === 429
            ? "Too many attempts. Wait a minute and retry."
            : result.error.status >= 500
              ? "Email or account services are unavailable. Contact your manager or retry later."
              : hasToken
                ? "This link could not be used. Request a new link and try again."
                : "The request could not be accepted. Check the address and retry."
        )
      } else {
        form.reset()
        setDone(true)
      }
    } catch {
      setError("Unable to connect. Check your connection and retry.")
    } finally {
      submitting.current = false
      setPending(false)
    }
  }
  return (
    <section className="space-y-5" aria-label="Account recovery">
      <div>
        <h2 className="text-lg font-semibold">
          {recovery.purpose === "reset"
            ? hasToken
              ? "Choose a new password"
              : "Reset your password"
            : "Verify your email"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {hasToken
            ? "Use this link only for your own staff account."
            : "Enter the email address your manager registered."}
        </p>
      </div>
      {done ? (
        <p role="status">
          {hasToken
            ? recovery.purpose === "reset"
              ? "Password changed. Sign in with your new password."
              : "Email verified. You can now sign in."
            : "Request accepted. If this account needs a link, check its email inbox."}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4" aria-busy={pending}>
          {!hasToken && (
            <div className="space-y-2">
              <Label htmlFor="recovery-email">Email address</Label>
              <Input
                id="recovery-email"
                name="recovery-email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                disabled={pending}
                className="h-11"
              />
            </div>
          )}
          {hasToken && recovery.purpose === "reset" && (
            <>
              <PasswordField
                id="new-password"
                label="New password"
                newPassword
                disabled={pending}
              />
              <PasswordField
                id="confirm-password"
                label="Confirm new password"
                newPassword
                disabled={pending}
              />
              <p className="text-sm text-muted-foreground">
                Use 12–128 characters. Changing your password signs out your
                existing sessions.
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="h-11 w-full" disabled={pending}>
            {pending
              ? "Working…"
              : hasToken
                ? recovery.purpose === "reset"
                  ? "Change password"
                  : "Verify email"
                : "Request email link"}
          </Button>
        </form>
      )}
      <Button type="button" variant="ghost" onClick={onBack} disabled={pending}>
        Back to sign in
      </Button>
    </section>
  )
}
