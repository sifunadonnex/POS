import { useRef, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { authClient } from "./auth-client"
import { PasswordField } from "./security-fields"
import { formText } from "./security-form"
import { MfaScreen } from "./mfa-screen"
import type { Staff } from "./identity-api"

export function AccountSecurity({
  staff,
  onChanged,
}: {
  staff: Staff
  onChanged: () => void
}) {
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [codes, setCodes] = useState<string[]>([])
  const [enrolling, setEnrolling] = useState(false)
  const submitting = useRef(false)
  async function submit(
    event: FormEvent<HTMLFormElement>,
    action: "password" | "codes"
  ) {
    event.preventDefault()
    if (submitting.current) return
    const form = event.currentTarget
    const data = new FormData(form)
    if (
      action === "password" &&
      formText(data, "new-password") !== formText(data, "confirm-password")
    ) {
      setError("The new passwords do not match.")
      return
    }
    submitting.current = true
    setPending(true)
    setError("")
    setMessage("")
    setCodes([])
    try {
      if (action === "password") {
        const result = await authClient.changePassword({
          currentPassword: formText(data, "current-password"),
          newPassword: formText(data, "new-password"),
          revokeOtherSessions: true,
        })
        if (result.error)
          throw new Error(
            "Password change could not be confirmed. Check your current password and retry."
          )
        form.reset()
        setMessage("Password changed. Other sessions have been signed out.")
        onChanged()
      } else {
        const result = await authClient.twoFactor.generateBackupCodes({
          password: formText(data, "backup-password"),
        })
        if (result.error || !result.data)
          throw new Error(
            "Recovery codes could not be regenerated. Check your password and retry."
          )
        setCodes(result.data.backupCodes)
        form.reset()
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
  if (enrolling)
    return (
      <MfaScreen
        enrollment
        onVerified={() => {
          setEnrolling(false)
          onChanged()
        }}
      />
    )
  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <h2 className="font-semibold">Account protection</h2>
        <p className="mt-2 text-sm">
          Email verified ·{" "}
          {staff.twoFactorEnabled
            ? "Authenticator enabled"
            : "Authenticator not yet enabled"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your screen locks after {staff.idleSeconds / 60} minutes without
          activity.
        </p>
        {!staff.twoFactorEnabled && (
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => setEnrolling(true)}
          >
            Set up an authenticator
          </Button>
        )}
      </div>
      <form
        onSubmit={(event) => {
          void submit(event, "password")
        }}
        className="space-y-4"
        aria-label="Change password"
      >
        <h2 className="font-semibold">Change password</h2>
        <PasswordField disabled={pending} />
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
        <Button type="submit" disabled={pending}>
          {pending ? "Working…" : "Change password"}
        </Button>
      </form>
      {staff.twoFactorEnabled && (
        <form
          onSubmit={(event) => {
            void submit(event, "codes")
          }}
          className="space-y-4 border-t pt-5"
          aria-label="New recovery codes"
        >
          <h2 className="font-semibold">Recovery codes</h2>
          <p className="text-sm text-muted-foreground">
            Generating new codes invalidates your previous recovery codes.
          </p>
          <PasswordField id="backup-password" disabled={pending} />
          <Button type="submit" variant="outline" disabled={pending}>
            Generate new recovery codes
          </Button>
        </form>
      )}
      {codes.length > 0 && (
        <div className="space-y-3 rounded-lg border p-4">
          <p role="status">
            Save these codes somewhere private. Each code works once.
          </p>
          <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
            {codes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
          <Button variant="outline" onClick={() => setCodes([])}>
            I saved these codes
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </div>
  )
}
