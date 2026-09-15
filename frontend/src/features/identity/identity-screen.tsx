import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { authClient } from "./auth-client"
import { getStaff, type Staff } from "./identity-api"
import { LoginForm } from "./login-form"

type Access =
  | { status: "loading" | "signed-out" | "error" }
  | { status: "ready"; staff: Staff }

export function IdentityScreen() {
  const [access, setAccess] = useState<Access>({ status: "loading" })
  const [revision, setRevision] = useState(0)
  const [signingOut, setSigningOut] = useState(false)
  const [logoutError, setLogoutError] = useState("")
  const signingOutRef = useRef(false)
  const refresh = () => {
    setAccess({ status: "loading" })
    setRevision((value) => value + 1)
  }

  useEffect(() => {
    let current: AbortController | undefined
    let disposed = false
    async function check() {
      current?.abort()
      const controller = new AbortController()
      current = controller
      const timeout = window.setTimeout(() => controller.abort(), 10_000)
      try {
        const staff = await getStaff(controller.signal)
        if (!disposed && current === controller)
          setAccess(
            staff ? { status: "ready", staff } : { status: "signed-out" }
          )
      } catch {
        if (!disposed && current === controller) setAccess({ status: "error" })
      } finally {
        window.clearTimeout(timeout)
      }
    }
    const recheck = () => {
      setAccess((current) =>
        current.status === "signed-out" ? current : { status: "loading" }
      )
      void check()
    }
    const offline = () => {
      current?.abort()
      setAccess({ status: "error" })
    }
    void check()
    const interval = window.setInterval(() => {
      void check()
    }, 60_000)
    window.addEventListener("focus", recheck)
    window.addEventListener("online", recheck)
    window.addEventListener("offline", offline)
    return () => {
      disposed = true
      current?.abort()
      window.clearInterval(interval)
      window.removeEventListener("focus", recheck)
      window.removeEventListener("online", recheck)
      window.removeEventListener("offline", offline)
    }
  }, [revision])

  async function signOut() {
    if (signingOutRef.current) return
    signingOutRef.current = true
    setSigningOut(true)
    setLogoutError("")
    try {
      const result = await authClient.signOut()
      if (result.error) throw new Error("Sign-out failed")
      refresh()
    } catch {
      setLogoutError(
        "Sign-out could not be confirmed. Reconnect and try again."
      )
    } finally {
      signingOutRef.current = false
      setSigningOut(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-4 sm:p-8">
      <section className="w-full max-w-md space-y-6" aria-label="Staff access">
        <header className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">
            Pay &amp; Go
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your shop. One connected workspace.
          </p>
        </header>
        <Card>
          <CardHeader>
            <CardTitle>
              {access.status === "ready" ? "Staff workspace" : "Staff sign in"}
            </CardTitle>
            <CardDescription>
              Local development · Not ready for live trading
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {access.status === "loading" && (
              <p role="status">Checking your session…</p>
            )}
            {access.status === "signed-out" && (
              <LoginForm onSignedIn={refresh} />
            )}
            {access.status === "error" && (
              <>
                <p role="alert">
                  We cannot verify your session. Check your connection and
                  retry.
                </p>
                <Button onClick={refresh}>Retry</Button>
              </>
            )}
            {access.status === "ready" && (
              <>
                <h2 className="text-lg font-medium">
                  Welcome, {access.staff.name}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Signed in as {access.staff.role}.
                </p>
                <p className="text-sm">
                  Your account is connected. Catalogue, checkout and reporting
                  are not implemented yet.
                </p>
              </>
            )}
            {(access.status === "ready" || access.status === "error") && (
              <Button
                variant="outline"
                onClick={() => {
                  void signOut()
                }}
                disabled={signingOut}
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </Button>
            )}
            {logoutError && (
              <p role="alert" className="text-sm text-destructive">
                {logoutError}
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
