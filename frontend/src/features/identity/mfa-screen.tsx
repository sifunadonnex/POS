import { useRef, useState, type FormEvent } from "react"
import { ArrowLeft, Check, CircleAlert, ShieldCheck } from "lucide-react"
import { REGEXP_ONLY_DIGITS } from "input-otp"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { authClient } from "./auth-client"
import { PasswordField } from "./security-fields"
import { formText } from "./security-form"

type Setup = { secret: string; backupCodes: string[] }

export function MfaScreen({
  enrollment = false,
  onVerified,
  onCancel,
  cancelLabel = "Back to sign in",
}: {
  enrollment?: boolean
  onVerified: () => void
  onCancel?: () => void
  cancelLabel?: string
}) {
  const [setup, setSetup] = useState<Setup | null>(null)
  const [saved, setSaved] = useState(false)
  const [backup, setBackup] = useState(false)
  const [code, setCode] = useState("")
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
        const verificationCode = backup
          ? formText(data, "mfa-code").trim()
          : code
        if (!backup && !/^[0-9]{6}$/.test(verificationCode))
          throw new Error("Enter all six digits from your authenticator app.")
        const result = backup
          ? await authClient.twoFactor.verifyBackupCode({
              code: verificationCode,
              trustDevice: false,
            })
          : await authClient.twoFactor.verifyTotp({
              code: verificationCode,
              trustDevice: false,
            })
        if (result.error)
          throw new Error(
            result.error.status === 429
              ? "Too many attempts. Wait before retrying."
              : "The code could not be verified. Try a fresh code or sign in again."
          )
        form.reset()
        setCode("")
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
      <div className="text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl border bg-muted/40 text-foreground shadow-xs">
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
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
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
              <p className="font-medium">Add POP N’ GO to your app</p>
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
          <div className="space-y-3 py-2">
            <Label htmlFor="mfa-code" className="justify-center">
              {backup ? "Recovery code" : "Authenticator code"}
            </Label>
            {backup ? (
              <Input
                id="mfa-code"
                name="mfa-code"
                autoComplete="one-time-code"
                maxLength={32}
                placeholder="Enter one saved code"
                required
                disabled={pending || (enrollment && !saved)}
                className="h-12 text-center font-mono"
              />
            ) : (
              <InputOTP
                id="mfa-code"
                name="mfa-code"
                value={code}
                onChange={(value) => {
                  setCode(value)
                  setError("")
                }}
                maxLength={6}
                pattern={REGEXP_ONLY_DIGITS}
                pasteTransformer={(value) => value.replace(/[\s-]/g, "")}
                autoComplete="one-time-code"
                inputMode="numeric"
                required
                disabled={pending || (enrollment && !saved)}
                aria-invalid={!!error}
                containerClassName="justify-center"
              >
                <InputOTPGroup className="gap-1.5 sm:gap-2">
                  {[0, 1, 2, 3, 4, 5].map((index) => (
                    <InputOTPSlot
                      key={index}
                      index={index}
                      aria-invalid={!!error}
                      className="h-12 w-8 rounded-lg! border-l! text-lg sm:h-14 sm:w-11"
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            )}
            <p className="text-center text-xs leading-5 text-muted-foreground">
              {backup
                ? "Each recovery code can only be used once."
                : "Enter the six-digit code. You can also paste it."}
            </p>
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
          disabled={
            pending ||
            (enrollment && !!setup && !saved) ||
            (!(enrollment && !setup) && !backup && code.length !== 6)
          }
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
            setCode("")
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
          {cancelLabel}
        </Button>
      )}
    </section>
  )
}
