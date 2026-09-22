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
import authRetailBackground from "@/assets/auth-retail-bg.png"
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

  if (ready && !access.staff.mfaRequired) {
    return (
      <main className="min-h-svh bg-muted/30 p-4 sm:p-6">
        <section className="w-full" aria-label="Staff access">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
              <div>
                <p className="text-sm text-muted-foreground">Signed in</p>
                <h1 className="text-2xl font-semibold tracking-tight">
                  Welcome, {access.staff.name}
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
            <StaffWorkspace
              key={access.staff.id}
              staff={access.staff}
              onSecurityChanged={session.refresh}
            />
          </div>
        </section>
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
    <main className="relative min-h-svh overflow-hidden bg-slate-950">
      <img
        src={authRetailBackground}
        alt=""
        className="absolute inset-0 size-full object-cover object-center"
      />
      <div
        className="absolute inset-0 bg-slate-950/55 lg:bg-gradient-to-r lg:from-slate-950/30 lg:via-slate-950/50 lg:to-slate-950/90"
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,transparent_0%,rgba(2,6,23,0.22)_46%,rgba(2,6,23,0.72)_100%)]"
        aria-hidden="true"
      />

      <section
        className="relative z-10 mx-auto grid min-h-svh w-full max-w-[92rem] items-center gap-10 px-4 py-6 sm:px-8 sm:py-10 lg:grid-cols-[minmax(0,1fr)_30rem] lg:px-12 xl:gap-20"
        aria-label="Staff access"
      >
        <div className="hidden max-w-2xl text-white lg:block">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl border border-white/15 bg-white/10 backdrop-blur-md">
              <ReceiptText className="size-6" aria-hidden="true" />
            </div>
            <div>
              <p className="text-lg font-semibold">Pay &amp; Go</p>
              <p className="text-sm text-white/65">Commerce workspace</p>
            </div>
          </div>

          <Badge className="mt-14 border-white/15 bg-white/10 text-white backdrop-blur-md">
            Built for the rhythm of retail
          </Badge>
          <h1 className="mt-5 max-w-xl text-5xl leading-[1.05] font-semibold tracking-tight xl:text-6xl">
            Every shift starts with a clear view.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-white/75">
            Sell, receive stock and keep the day reconciled from one protected
            workspace designed for your team.
          </p>

          <div className="mt-10 grid max-w-xl gap-3 sm:grid-cols-3">
            <HeroPoint icon={ShoppingCart} label="Fast checkout" />
            <HeroPoint icon={Boxes} label="Live inventory" />
            <HeroPoint icon={ShieldCheck} label="Secure access" />
          </div>
        </div>

        <div className="mx-auto w-full max-w-lg lg:mx-0">
          <div className="mb-5 flex items-center gap-3 text-white lg:hidden">
            <div className="flex size-10 items-center justify-center rounded-xl border border-white/15 bg-white/10 backdrop-blur-md">
              <ReceiptText className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="font-semibold">Pay &amp; Go</p>
              <p className="text-xs text-white/65">Your connected workspace</p>
            </div>
          </div>

          <Card className="overflow-hidden border-white/20 bg-background/95 shadow-2xl shadow-black/30 backdrop-blur-xl">
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
          <p className="mt-4 text-center text-xs text-white/60">
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
    <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-black/15 px-3 py-3 text-sm backdrop-blur-sm">
      <Icon className="size-4 text-amber-300" aria-hidden="true" />
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
