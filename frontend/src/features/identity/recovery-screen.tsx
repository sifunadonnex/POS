import { useRef, useState, type FormEvent } from "react"
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  KeyRound,
  MailCheck,
  Send,
} from "lucide-react"
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
  const reset = recovery.purpose === "reset"
  return (
    <section className="space-y-5" aria-label="Account recovery">
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {reset ? (
            <KeyRound className="size-5" aria-hidden="true" />
          ) : (
            <MailCheck className="size-5" aria-hidden="true" />
          )}
        </div>
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {reset ? "Account recovery" : "Email confirmation"}
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">
            {reset
              ? hasToken
                ? "Choose a new password"
                : "Reset your password"
              : "Verify your email"}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {hasToken
              ? reset
                ? "Create a strong replacement password for your staff account."
                : "Confirm this email before opening the staff workspace."
              : "Enter the email address registered by your manager."}
          </p>
        </div>
      </div>
      {done ? (
        <div
          role="status"
          className="flex gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4"
        >
          <CheckCircle2
            className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
          <div>
            <p className="font-medium">
              {hasToken
                ? reset
                  ? "Password updated"
                  : "Email verified"
                : "Request accepted"}
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {hasToken
                ? reset
                  ? "Password changed. Sign in with your new password."
                  : "Email verified. You can now sign in."
                : "If this account needs a link, check its email inbox."}
            </p>
          </div>
        </div>
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
                placeholder="you@shop.example"
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
              <p className="rounded-lg border bg-muted/35 p-3 text-sm leading-6 text-muted-foreground">
                Use 12–128 characters. Changing your password signs out your
                existing sessions.
              </p>
            </>
          )}
          {error && (
            <div
              role="alert"
              className="flex gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"
            >
              <CircleAlert
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <p>{error}</p>
            </div>
          )}
          {!hasToken && (
            <p className="text-xs leading-5 text-muted-foreground">
              For your security, the response is the same whether or not the
              address belongs to an account.
            </p>
          )}
          <Button
            type="submit"
            className="h-11 w-full gap-2"
            disabled={pending}
          >
            {pending
              ? "Working…"
              : hasToken
                ? reset
                  ? "Change password"
                  : "Verify email"
                : "Request email link"}
            {!pending && <Send className="size-4" aria-hidden="true" />}
          </Button>
        </form>
      )}
      <Button
        type="button"
        variant="ghost"
        className="gap-2 px-0"
        onClick={onBack}
        disabled={pending}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to sign in
      </Button>
    </section>
  )
}
