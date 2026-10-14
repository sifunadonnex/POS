import { useEffect, useState, type ReactNode } from "react"
import {
  Boxes,
  LoaderCircle,
  LockKeyhole,
  ReceiptText,
  ShieldCheck,
  ShoppingCart,
  WifiOff,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
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
  const verifying =
    mfaChallenge || (access.status === "ready" && access.staff.mfaRequired)
  const authHeading = recovery
    ? recovery.purpose === "reset"
      ? "A fresh start for your account."
      : "One step closer to your workspace."
    : verifying
      ? "A little extra protection for your shop."
      : "Every shift starts with a clear view."
  const authDescription = recovery
    ? recovery.purpose === "reset"
      ? "Recover access to your staff account and return to the work that matters."
      : "Confirm your email address to keep your staff account and recovery links connected to you."
    : verifying
      ? "Your authenticator helps keep sales, stock and staff controls in the right hands."
      : "Sell, receive stock and keep the day reconciled from one protected workspace designed for your team."

  if (ready && !access.staff.mfaRequired) {
    return (
      <main
        className="fixed inset-0 overflow-hidden bg-background"
        aria-label="Staff access"
      >
        <StaffWorkspace
          key={access.staff.id}
          staff={access.staff}
          signingOut={session.signingOut}
          onSignOut={() => {
            void session.signOut()
          }}
          onSecurityChanged={session.refresh}
        />
      </main>
    )
  }

  let content: ReactNode
  if (recovery) {
    content = (
      <RecoveryScreen
        recovery={recovery}
        onBack={() => {
          setRecovery(null)
          session.refresh()
        }}
      />
    )
  } else if (mfaChallenge) {
    content = (
      <MfaScreen
        onVerified={signedIn}
        onCancel={() => {
          setMfaChallenge(false)
          void session.signOut()
        }}
      />
    )
  } else if (access.status === "ready") {
    content = <MfaScreen enrollment onVerified={session.refresh} />
  } else if (access.status === "loading") {
    content = (
      <AuthState
        icon={
          <LoaderCircle
            className="size-6 animate-spin text-primary"
            aria-hidden="true"
          />
        }
        title="Preparing your workspace"
      >
        <p role="status">Checking your session…</p>
      </AuthState>
    )
  } else if (access.status === "signed-out") {
    content = (
      <LoginForm
        onSignedIn={signedIn}
        onMfaRequired={() => setMfaChallenge(true)}
        onRecovery={(purpose) => setRecovery({ purpose })}
      />
    )
  } else if (access.status === "error") {
    content = (
      <AuthState
        icon={
          <WifiOff className="size-6 text-destructive" aria-hidden="true" />
        }
        title="We couldn’t reach your workspace"
      >
        <p role="alert">
          We cannot verify your session. Check your connection and retry.
        </p>
        <Button onClick={session.refresh} className="mt-4 w-full">
          Retry
        </Button>
      </AuthState>
    )
  } else {
    content = (
      <AuthState
        icon={
          <LockKeyhole className="size-6 text-primary" aria-hidden="true" />
        }
        title="Your screen is locked"
      >
        <p>
          Sign-out must be confirmed before you sign in again. Reconnect, then
          try signing out once more.
        </p>
        <Button
          className="mt-4 w-full"
          variant="outline"
          disabled={session.signingOut}
          onClick={() => {
            void session.signOut()
          }}
        >
          {session.signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </AuthState>
    )
  }

  return (
    <main className="relative min-h-svh overflow-hidden bg-background">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(var(--border)_1px,transparent_1px)] mask-[radial-gradient(ellipse_at_center,black,transparent_75%)] bg-size-[20px_20px]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 bg-linear-to-b from-transparent to-muted/40"
        aria-hidden="true"
      />

      <section
        className="relative z-10 mx-auto grid min-h-svh w-full max-w-6xl items-center gap-10 px-4 py-6 sm:px-8 sm:py-10 lg:grid-cols-[minmax(0,1fr)_26rem] lg:px-12 xl:gap-20"
        aria-label="Staff access"
      >
        <div className="hidden max-w-2xl lg:block">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ReceiptText className="size-6" aria-hidden="true" />
            </div>
            <div>
              <p className="text-lg font-semibold">Pay &amp; Go</p>
              <p className="text-sm text-muted-foreground">
                Commerce workspace
              </p>
            </div>
          </div>

          <Badge variant="outline" className="mt-14 rounded-full bg-background">
            Built for the rhythm of retail
          </Badge>
          <h1 className="mt-5 max-w-xl text-4xl leading-tight font-semibold tracking-tight xl:text-5xl">
            {authHeading}
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">
            {authDescription}
          </p>

          <div className="mt-10 grid max-w-xl gap-3 sm:grid-cols-3">
            <HeroPoint icon={ShoppingCart} label="Fast checkout" />
            <HeroPoint icon={Boxes} label="Live inventory" />
            <HeroPoint icon={ShieldCheck} label="Secure access" />
          </div>
        </div>

        <div className="mx-auto w-full max-w-lg lg:mx-0">
          <div className="mb-5 flex items-center gap-3 lg:hidden">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ReceiptText className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="font-semibold">Pay &amp; Go</p>
              <p className="text-xs text-muted-foreground">
                Your connected workspace
              </p>
            </div>
          </div>

          <Card className="overflow-hidden rounded-2xl bg-card shadow-xl shadow-foreground/5">
            <CardHeader className="border-b bg-muted/25 px-5 py-4 sm:px-7">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <ShieldCheck className="size-4" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Secure staff access</p>
                    <p className="text-xs text-muted-foreground">
                      Main shop workspace
                    </p>
                  </div>
                </div>
                <Badge variant="secondary" className="rounded-full">
                  Protected
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="px-5 py-6 sm:px-7 sm:py-7">
              {content}
              {session.logoutError && (
                <div
                  role="alert"
                  className="mt-5 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"
                >
                  {session.logoutError}
                </div>
              )}
            </CardContent>
          </Card>
          <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
            Authorized staff only · Sessions lock automatically when inactive
          </p>
        </div>
      </section>
    </main>
  )
}

function HeroPoint({
  icon: Icon,
  label,
}: {
  icon: typeof ShoppingCart
  label: string
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border bg-card px-3 py-3 text-sm">
      <Icon
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span>{label}</span>
    </div>
  )
}

function AuthState({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <div className="py-3 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-muted">
        {icon}
      </div>
      <h2 className="mt-4 text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
        {children}
      </div>
    </div>
  )
}
