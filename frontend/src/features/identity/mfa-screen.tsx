import { useRef, useState, type FormEvent } from "react"
import {
  ArrowLeft,
  Check,
  CircleAlert,
  KeyRound,
  ShieldCheck,
  Smartphone,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient } from "./auth-client"
import { PasswordField } from "./security-fields"
import { formText } from "./security-form"

type Setup = { secret: string; backupCodes: string[] }

export function MfaScreen({
  enrollment = false,
  onVerified,
  onCancel,
}: {
  enrollment?: boolean
  onVerified: () => void
  onCancel?: () => void
}) {
  const [setup, setSetup] = useState<Setup | null>(null)
  const [saved, setSaved] = useState(false)
  const [backup, setBackup] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const submitting = useRef(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setPending(true)
    setError("")
    const form = event.currentTarget
    const data = new FormData(form)
    try {
      if (enrollment && !setup) {
        const result = await authClient.twoFactor.enable({
          password: formText(data, "current-password"),
        })
        if (
          result.error ||
          !result.data ||
          !("totpURI" in result.data) ||
          typeof result.data.totpURI !== "string"
        )
          throw new Error(
            "Setup could not be started. Check your password and retry."
          )
        const secret = new URL(result.data.totpURI).searchParams.get("secret")
        if (
          !secret ||
          !Array.isArray(result.data.backupCodes) ||
          !result.data.backupCodes.every((value) => typeof value === "string")
        )
          throw new Error("The setup response was invalid. Please retry.")
        setSetup({ secret, backupCodes: result.data.backupCodes })
        form.reset()
      } else {
        const code = formText(data, "mfa-code").trim()
        const result = backup
          ? await authClient.twoFactor.verifyBackupCode({
              code,
              trustDevice: false,
            })
          : await authClient.twoFactor.verifyTotp({ code, trustDevice: false })
        if (result.error)
          throw new Error(
            result.error.status === 429
              ? "Too many attempts. Wait before retrying."
              : "The code could not be verified. Try a fresh code or sign in again."
          )
        form.reset()
        setSetup(null)
        onVerified()
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to connect. Please retry."
      )
    } finally {
      submitting.current = false
      setPending(false)
    }
  }
  return (
    <section className="space-y-5" aria-label="Two-factor authentication">
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {enrollment
              ? setup
                ? "Step 2 of 2"
                : "Step 1 of 2"
              : "Security check"}
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">
            {enrollment ? "Set up your authenticator" : "Confirm it’s you"}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {enrollment
              ? "Managers add an extra verification step before accessing sensitive controls."
              : "Use a fresh code from your authenticator app, or switch to a recovery code."}
          </p>
        </div>
      </div>
      {setup && (
        <div className="space-y-5 rounded-xl border bg-muted/20 p-4">
          <div className="flex gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background font-semibold shadow-xs">
              1
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium">Add Pay &amp; Go to your app</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Create a time-based account in your authenticator app, then
                enter this setup key.
              </p>
              <Label htmlFor="authenticator-secret" className="mt-3">
                Setup key
              </Label>
              <Input
                id="authenticator-secret"
                value={setup.secret}
                readOnly
                className="mt-2 font-mono tracking-wider"
              />
            </div>
          </div>
          <div className="flex gap-3 border-t pt-5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background font-semibold shadow-xs">
              2
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-medium">Save your recovery codes</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Store these somewhere private. Each code works once if you lose
                your authenticator.
              </p>
              <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs">
                {setup.backupCodes.map((code) => (
                  <li
                    key={code}
                    className="rounded-md border bg-background px-2 py-1.5 text-center"
                  >
                    {code}
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                variant={saved ? "secondary" : "outline"}
                className="mt-3 gap-2"
                onClick={() => setSaved(true)}
                disabled={saved}
              >
                {saved && <Check className="size-4" aria-hidden="true" />}
                {saved ? "Recovery codes saved" : "I saved my recovery codes"}
              </Button>
            </div>
          </div>
        </div>
      )}
      <form onSubmit={submit} className="space-y-4" aria-busy={pending}>
        {enrollment && !setup ? (
          <PasswordField disabled={pending} />
        ) : (
          <div className="space-y-2 rounded-xl border bg-background p-4">
            <div className="flex items-center gap-2">
              {backup ? (
                <KeyRound
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
              ) : (
                <Smartphone
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              <Label htmlFor="mfa-code">
                {backup ? "Recovery code" : "Authenticator code"}
              </Label>
            </div>
            <Input
              id="mfa-code"
              name="mfa-code"
              autoComplete="one-time-code"
              inputMode={backup ? "text" : "numeric"}
              pattern={backup ? undefined : "[0-9]{6}"}
              maxLength={backup ? 32 : 6}
              placeholder={backup ? "Enter one saved code" : "000000"}
              required
              disabled={pending || (enrollment && !saved)}
              className="h-12 text-center font-mono text-lg tracking-[0.35em]"
            />
            {enrollment && setup && !saved && (
              <p className="text-xs text-muted-foreground">
                Confirm that you saved the recovery codes before continuing.
              </p>
            )}
          </div>
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
        <Button
          type="submit"
          className="h-11 w-full"
          disabled={pending || (enrollment && !!setup && !saved)}
        >
          {pending
            ? "Checking…"
            : enrollment && !setup
              ? "Start authenticator setup"
              : "Verify code"}
        </Button>
      </form>
      {!enrollment && (
        <Button
          type="button"
          variant="outline"
          className="w-full gap-2"
          disabled={pending}
          onClick={() => {
            setBackup(!backup)
            setError("")
          }}
        >
          {backup ? "Use authenticator code" : "Use a recovery code"}
        </Button>
      )}
      {onCancel && (
        <Button
          type="button"
          variant="ghost"
          className="w-full gap-2"
          disabled={pending}
          onClick={onCancel}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to sign in
        </Button>
      )}
    </section>
  )
}
