import { useEffect, useState } from "react"
import { getRuntimeStatus, type RuntimeStatus } from "./runtime-status-api"

export type RuntimeStatusState =
  | { status: "loading" }
  | { status: "ready"; value: RuntimeStatus }
  | { status: "error" }

export function useRuntimeStatus(): RuntimeStatusState {
  const [state, setState] = useState<RuntimeStatusState>({ status: "loading" })

  useEffect(() => {
    let current: AbortController | undefined
    let disposed = false
    async function load() {
      current?.abort()
      const controller = new AbortController()
      current = controller
      try {
        const value = await getRuntimeStatus(controller.signal)
        if (!disposed && current === controller) {
          setState({ status: "ready", value })
        }
      } catch {
        if (!disposed && current === controller) setState({ status: "error" })
      }
    }
    const refresh = () => void load()
    void load()
    const interval = window.setInterval(refresh, 30_000)
    window.addEventListener("focus", refresh)
    window.addEventListener("online", refresh)
    window.addEventListener("offline", refresh)
    return () => {
      disposed = true
      current?.abort()
      window.clearInterval(interval)
      window.removeEventListener("focus", refresh)
      window.removeEventListener("online", refresh)
      window.removeEventListener("offline", refresh)
    }
  }, [])

  return state
}
