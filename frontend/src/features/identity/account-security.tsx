import { useRef, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Clock3, KeyRound, ShieldCheck } from "lucide-react"
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
      <Card>
        <CardContent className="mx-auto w-full max-w-lg py-4">
          <MfaScreen
            enrollment
            onCancel={() => setEnrolling(false)}
            cancelLabel="Back to security"
            onVerified={() => {
              setEnrolling(false)
              onChanged()
            }}
          />
        </CardContent>
      </Card>
    )
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Account protection</CardTitle>
          <CardDescription>
            Keep access to your staff account secure.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex gap-3">
              <ShieldCheck
                className="mt-0.5 size-5 text-muted-foreground"
                aria-hidden="true"
              />
              <div>
                <h3 className="text-sm font-medium">
                  Two-factor authentication
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  An authenticator code adds a second check when you sign in.
                </p>
              </div>
            </div>
            <Badge variant={staff.twoFactorEnabled ? "secondary" : "outline"}>
              {staff.twoFactorEnabled ? "Enabled" : "Not enabled"}
            </Badge>
          </div>
          {!staff.twoFactorEnabled && (
            <Button
              className="mt-3"
              variant="outline"
              onClick={() => setEnrolling(true)}
            >
              Set up an authenticator
            </Button>
          )}
          <div className="flex gap-3 border-t pt-4">
            <Clock3
              className="mt-0.5 size-5 text-muted-foreground"
              aria-hidden="true"
            />
            <div>
              <h3 className="text-sm font-medium">Automatic screen lock</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Your screen locks after {staff.idleSeconds / 60} minutes without
                activity. This policy is managed by the account service.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Change password</CardTitle>
          <CardDescription>
            Use 12–128 characters. Updating your password signs out other
            sessions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => {
              void submit(event, "password")
            }}
            className="space-y-4"
            aria-label="Change password"
            aria-busy={pending}
          >
            <div className="max-w-md space-y-4">
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
            </div>
            <div className="flex justify-end border-t pt-4">
              <Button type="submit" disabled={pending} className="gap-2">
                <KeyRound className="size-4" aria-hidden="true" />
                {pending ? "Working…" : "Change password"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      {staff.twoFactorEnabled && (
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Recovery codes</CardTitle>
            <CardDescription>
              Use a recovery code if you lose access to your authenticator.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(event) => {
                void submit(event, "codes")
              }}
              className="space-y-4"
              aria-label="New recovery codes"
              aria-busy={pending}
            >
              <p className="text-sm text-muted-foreground">
                Generating new codes invalidates your previous recovery codes.
              </p>
              <div className="max-w-md">
                <PasswordField id="backup-password" disabled={pending} />
              </div>
              <Button type="submit" variant="outline" disabled={pending}>
                Generate new recovery codes
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
      {codes.length > 0 && (
        <div className="space-y-3 rounded-lg border p-4">
          <p role="status">
            Save these codes somewhere private. Each code works once.
          </p>
          <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
            {codes.map((code) => (
              <li
                key={code}
                className="rounded-lg border bg-card p-3 text-center"
              >
                {code}
              </li>
            ))}
          </ul>
          <Button variant="outline" onClick={() => setCodes([])}>
            I saved these codes
          </Button>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-xl border bg-card p-4 text-sm">
          {message}
        </p>
      )}
    </div>
  )
}
