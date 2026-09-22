import { useRef, useState, type FormEvent } from "react"
import {
  ArrowRight,
  CircleAlert,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  UserRoundCheck,
} from "lucide-react"
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
  const [showPassword, setShowPassword] = useState(false)
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
      <div>
        <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
          Staff portal
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">
          Welcome back
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Sign in with the account assigned by your manager to open today’s
          workspace.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <div className="relative">
          <Mail
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            placeholder="you@shop.example"
            required
            maxLength={254}
            disabled={pending}
            className="h-11 pl-10"
          />
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="password">Password</Label>
          {onRecovery && (
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-xs"
              disabled={pending}
              onClick={() => onRecovery("reset")}
            >
              Forgot password?
            </Button>
          )}
        </div>
        <div className="relative">
          <LockKeyhole
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            maxLength={128}
            disabled={pending}
            aria-describedby={error ? "login-error" : undefined}
            className="h-11 px-10"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute top-1/2 right-1 size-9 -translate-y-1/2 text-muted-foreground"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            disabled={pending}
            onClick={() => setShowPassword((value) => !value)}
          >
            {showPassword ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>
      {error && (
        <div
          id="login-error"
          role="alert"
          className="flex gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
      )}
      <Button type="submit" disabled={pending} className="h-11 w-full gap-2">
        {pending ? "Signing in…" : "Sign in"}
        {!pending && <ArrowRight className="size-4" aria-hidden="true" />}
      </Button>

      <div className="rounded-lg border bg-muted/35 p-3.5">
        <div className="flex gap-3">
          <UserRoundCheck
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-medium">Staff access only</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Accounts are created by your manager. Shared tills do not keep you
              signed in after your session ends.
            </p>
          </div>
        </div>
        {onRecovery && (
          <Button
            type="button"
            variant="link"
            className="mt-2 h-auto p-0 text-xs"
            aria-label="Verify email"
            disabled={pending}
            onClick={() => onRecovery("verify")}
          >
            Need a new verification email?
          </Button>
        )}
      </div>
    </form>
  )
}
