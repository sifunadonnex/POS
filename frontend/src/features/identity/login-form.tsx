import { useRef, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient } from "./auth-client"

export function LoginForm({
  onSignedIn,
  onMfaRequired,
  onRecovery,
}: {
  onSignedIn: () => void
  onMfaRequired?: () => void
  onRecovery?: (purpose: "reset" | "verify") => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const submitting = useRef(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const form = event.currentTarget
    const values = new FormData(form)
    const email = values.get("email")
    const password = values.get("password")
    if (typeof email !== "string" || typeof password !== "string") return
    submitting.current = true
    setPending(true)
    setError("")
    try {
      const result = await authClient.signIn.email({
        email: email.trim(),
        password,
        rememberMe: false,
      })
      if (result.error) {
        setError(
          result.error.status === 429
            ? "Too many attempts. Wait a minute before trying again."
            : result.error.code === "EMAIL_NOT_VERIFIED"
              ? "Verify your email before signing in. Use the verification link below."
              : result.error.status >= 500
                ? "Sign-in is unavailable. Please retry."
                : "Sign-in failed. Check your email and password."
        )
      } else {
        form.reset()
        if (
          result.data &&
          "twoFactorRedirect" in result.data &&
          result.data.twoFactorRedirect === true
        ) {
          if (onMfaRequired) onMfaRequired()
          else setError("Two-factor verification is required to continue.")
        } else onSignedIn()
      }
    } catch {
      setError("Unable to connect. Check your connection and retry.")
    } finally {
      submitting.current = false
      setPending(false)
    }
  }
  return (
    <form onSubmit={submit} className="space-y-5" aria-busy={pending}>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
          disabled={pending}
          className="h-11"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
          disabled={pending}
          aria-describedby={error ? "login-error" : undefined}
          className="h-11"
        />
      </div>
      {error && (
        <p id="login-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-11 w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-sm text-muted-foreground">
        Staff accounts are created by your administrator. Contact them if you
        cannot sign in.
      </p>
      {onRecovery && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="link"
            disabled={pending}
            onClick={() => onRecovery("reset")}
          >
            Forgot password?
          </Button>
          <Button
            type="button"
            variant="link"
            disabled={pending}
            onClick={() => onRecovery("verify")}
          >
            Verify email
          </Button>
        </div>
      )}
    </form>
  )
}
