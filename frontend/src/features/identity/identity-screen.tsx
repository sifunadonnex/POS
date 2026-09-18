import { useEffect, useState } from "react"
import { ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { LoginForm } from "./login-form"
import { RecoveryScreen } from "./recovery-screen"
import { readRecoveryLink, type Recovery } from "./recovery-link"
import { MfaScreen } from "./mfa-screen"
import { StaffWorkspace } from "../workspace/staff-workspace"
import { useStaffSession } from "./use-staff-session"

export function IdentityScreen() {
  const session = useStaffSession()
  const { access } = session
  const [recovery, setRecovery] = useState<Recovery | null>(readRecoveryLink)
  const [mfaChallenge, setMfaChallenge] = useState(false)

  useEffect(() => {
    if (recovery?.token !== undefined)
      window.history.replaceState(null, "", window.location.pathname)
  }, [recovery])

  function signedIn() {
    setMfaChallenge(false)
    setRecovery(null)
    session.signedIn()
  }

  const ready = access.status === "ready" && !recovery && !mfaChallenge

  return (
    <main
      className={`flex min-h-svh bg-muted/30 p-4 sm:p-6 ${
        ready ? "items-start justify-stretch" : "items-center justify-center"
      }`}
    >
      <section
        className={`w-full ${ready ? "max-w-none" : "mx-auto max-w-md"}`}
        aria-label="Staff access"
      >
        {ready ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
              <div>
                <p className="text-sm text-muted-foreground">Signed in</p>
                <h1 className="text-2xl font-semibold tracking-tight">
                  {access.staff.name}
                </h1>
              </div>
              <Button
                variant="outline"
                disabled={session.signingOut}
                onClick={() => {
                  void session.signOut()
                }}
              >
                {session.signingOut ? "Signing out…" : "Sign out"}
              </Button>
            </div>
            {access.staff.mfaRequired ? (
              <MfaScreen
                enrollment={!access.staff.twoFactorEnabled}
                onVerified={session.refresh}
              />
            ) : (
              <StaffWorkspace
                key={access.staff.id}
                staff={access.staff}
                onSecurityChanged={session.refresh}
              />
            )}
          </div>
        ) : (
          <>
            <header className="text-center">
              <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <ShieldCheck aria-hidden="true" className="size-6" />
              </div>
              <h1 className="text-3xl font-semibold tracking-tight">
                Pay &amp; Go
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Your shop. One connected workspace.
              </p>
            </header>

            <Card>
              <CardHeader>
                <CardTitle>Staff sign in</CardTitle>
                <CardDescription>
                  Find products, manage your account and keep staff access secure.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {recovery ? (
                  <RecoveryScreen
                    recovery={recovery}
                    onBack={() => {
                      setRecovery(null)
                      session.refresh()
                    }}
                  />
                ) : mfaChallenge ? (
                  <MfaScreen
                    onVerified={signedIn}
                    onCancel={() => {
                      setMfaChallenge(false)
                      void session.signOut()
                    }}
                  />
                ) : (
                  <>
                    {access.status === "loading" && (
                      <p role="status">Checking your session…</p>
                    )}
                    {access.status === "signed-out" && (
                      <LoginForm
                        onSignedIn={signedIn}
                        onMfaRequired={() => setMfaChallenge(true)}
                        onRecovery={(purpose) => setRecovery({ purpose })}
                      />
                    )}
                    {access.status === "error" && (
                      <div className="space-y-3">
                        <p role="alert">
                          We cannot verify your session. Check your connection and
                          retry.
                        </p>
                        <Button onClick={session.refresh}>Retry</Button>
                      </div>
                    )}
                    {access.status === "locked" && (
                      <div className="space-y-2">
                        <h2 className="text-lg font-semibold">
                          Your screen is locked
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          Sign-out must be confirmed before you sign in again.
                        </p>
                      </div>
                    )}
                    {["ready", "error", "locked"].includes(access.status) && (
                      <div className="border-t pt-4">
                        <Button
                          variant="outline"
                          disabled={session.signingOut}
                          onClick={() => {
                            void session.signOut()
                          }}
                        >
                          {session.signingOut ? "Signing out…" : "Sign out"}
                        </Button>
                      </div>
                    )}
                  </>
                )}

                {session.logoutError && (
                  <p role="alert" className="text-sm text-destructive">
                    {session.logoutError}
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </section>
    </main>
  )
}
