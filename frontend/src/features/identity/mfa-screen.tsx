import { useRef, useState, type FormEvent } from "react"
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
      <div>
        <h2 className="text-lg font-semibold">
          {enrollment ? "Set up your authenticator" : "Confirm it’s you"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {enrollment
            ? "Managers must set up two-factor authentication before accessing staff controls."
            : "Enter a code from your authenticator app, or use a recovery code."}
        </p>
      </div>
      {setup && (
        <div className="space-y-4 rounded-lg border p-4">
          <p className="text-sm">
            In your authenticator app, add a time-based account named Pay &amp;
            Go and enter this setup key:
          </p>
          <Label htmlFor="authenticator-secret">Setup key</Label>
          <Input
            id="authenticator-secret"
            value={setup.secret}
            readOnly
            className="font-mono"
          />
          <h3 className="font-medium">Save your recovery codes</h3>
          <p className="text-sm text-muted-foreground">
            Store these somewhere private. Each code works once if you lose your
            authenticator.
          </p>
          <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
            {setup.backupCodes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
          <Button
            type="button"
            variant={saved ? "secondary" : "outline"}
            onClick={() => setSaved(true)}
            disabled={saved}
          >
            {saved ? "Recovery codes saved" : "I saved my recovery codes"}
          </Button>
        </div>
      )}
      <form onSubmit={submit} className="space-y-4" aria-busy={pending}>
        {enrollment && !setup ? (
          <PasswordField disabled={pending} />
        ) : (
          <div className="space-y-2">
            <Label htmlFor="mfa-code">
              {backup ? "Recovery code" : "Authenticator code"}
            </Label>
            <Input
              id="mfa-code"
              name="mfa-code"
              autoComplete="one-time-code"
              inputMode={backup ? "text" : "numeric"}
              pattern={backup ? undefined : "[0-9]{6}"}
              maxLength={backup ? 32 : 6}
              required
              disabled={pending || (enrollment && !saved)}
              className="h-11 font-mono"
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
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
          variant="ghost"
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
          disabled={pending}
          onClick={onCancel}
        >
          Back to sign in
        </Button>
      )}
    </section>
  )
}
