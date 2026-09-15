import { useCallback, useEffect, useRef, useState } from "react"
import { authClient } from "./auth-client"
import { getStaff, identityRequest, type Staff } from "./identity-api"

export type Access =
  | { status: "loading" | "signed-out" | "error" | "locked" }
  | { status: "ready"; staff: Staff }

export function useStaffSession() {
  const [access, setAccess] = useState<Access>({ status: "loading" })
  const [revision, setRevision] = useState(0)
  const [signingOut, setSigningOut] = useState(false)
  const [logoutError, setLogoutError] = useState("")
  const locked = useRef(false)
  const busy = useRef(false)
  const generation = useRef(0)
  const lastActivity = useRef(0)
  const lastSent = useRef(0)
  useEffect(() => {
    lastActivity.current = Date.now()
    lastSent.current = Date.now()
  }, [])
  const refresh = useCallback(() => {
    setRevision((value) => value + 1)
  }, [])
  const signedIn = useCallback(() => {
    locked.current = false
    lastActivity.current = Date.now()
    lastSent.current = Date.now()
    setAccess({ status: "loading" })
    setLogoutError("")
    refresh()
  }, [refresh])

  const signOut = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    locked.current = true
    generation.current += 1
    setAccess({ status: "locked" })
    setSigningOut(true)
    setLogoutError("")
    try {
      const result = await authClient.signOut()
      if (result.error) throw new Error("Sign-out failed")
      setAccess({ status: "signed-out" })
    } catch {
      setLogoutError(
        "Sign-out could not be confirmed. Your screen is locked. Reconnect and try again."
      )
    } finally {
      busy.current = false
      setSigningOut(false)
    }
  }, [])

  useEffect(() => {
    let current: AbortController | undefined
    let disposed = false
    async function check() {
      if (locked.current) return
      current?.abort()
      const controller = new AbortController()
      const checkGeneration = generation.current
      current = controller
      const timeout = window.setTimeout(() => controller.abort(), 10_000)
      try {
        const staff = await getStaff(controller.signal)
        if (
          !disposed &&
          current === controller &&
          checkGeneration === generation.current &&
          !locked.current
        ) {
          setAccess(
            staff ? { status: "ready", staff } : { status: "signed-out" }
          )
        }
      } catch {
        if (
          !disposed &&
          current === controller &&
          checkGeneration === generation.current &&
          !locked.current
        )
          setAccess({ status: "error" })
      } finally {
        window.clearTimeout(timeout)
      }
    }
    const recheck = () => {
      void check()
    }
    const offline = () => {
      current?.abort()
      if (!locked.current) setAccess({ status: "error" })
    }
    const expired = () => {
      current?.abort()
      generation.current += 1
      setAccess({ status: "signed-out" })
    }
    void check()
    const interval = window.setInterval(recheck, 60_000)
    window.addEventListener("focus", recheck)
    window.addEventListener("online", recheck)
    window.addEventListener("offline", offline)
    window.addEventListener("paygo-session-expired", expired)
    return () => {
      disposed = true
      current?.abort()
      window.clearInterval(interval)
      window.removeEventListener("focus", recheck)
      window.removeEventListener("online", recheck)
      window.removeEventListener("offline", offline)
      window.removeEventListener("paygo-session-expired", expired)
    }
  }, [revision])

  const idleSeconds =
    access.status === "ready" ? access.staff.idleSeconds : null
  useEffect(() => {
    if (idleSeconds === null) return
    let sending = false
    const activity = () => {
      if (Date.now() - lastActivity.current >= idleSeconds * 1000) {
        void signOut()
        return
      }
      lastActivity.current = Date.now()
    }
    const tick = async () => {
      if (Date.now() - lastActivity.current >= idleSeconds * 1000) {
        void signOut()
        return
      }
      if (
        sending ||
        locked.current ||
        document.visibilityState === "hidden" ||
        lastActivity.current <= lastSent.current ||
        Date.now() - lastSent.current < 30_000
      )
        return
      sending = true
      const activityAt = lastActivity.current
      try {
        await identityRequest("activity", {})
        lastSent.current = activityAt
      } catch {
        if (!locked.current) setAccess({ status: "error" })
      } finally {
        sending = false
      }
    }
    const checkOnFocus = () => {
      void tick()
    }
    for (const event of ["pointerdown", "keydown", "touchstart"])
      window.addEventListener(event, activity)
    window.addEventListener("focus", checkOnFocus)
    const interval = window.setInterval(() => {
      void tick()
    }, 1000)
    return () => {
      for (const event of ["pointerdown", "keydown", "touchstart"])
        window.removeEventListener(event, activity)
      window.removeEventListener("focus", checkOnFocus)
      window.clearInterval(interval)
    }
  }, [idleSeconds, signOut])
  return { access, refresh, signedIn, signOut, signingOut, logoutError }
}
