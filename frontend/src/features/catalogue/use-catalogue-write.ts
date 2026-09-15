import { useEffect, useRef, useState } from "react"
import { CatalogueError, catalogueRequest } from "./catalogue-api"
import { errorMessage } from "./catalogue-format"

type Attempt = { path: string; body: Record<string, unknown>; method: string }
export function useCatalogueWrite(onSaved: (result: unknown) => void) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [uncertain, setUncertain] = useState(false)
  const busy = useRef(false),
    attempt = useRef<Attempt | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  async function send(next: Attempt) {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setError("")
    attempt.current = next
    try {
      const result = await catalogueRequest(next.path, next.body, next.method)
      if (!mounted.current) return
      onSaved(result)
      attempt.current = null
      setUncertain(false)
    } catch (failure) {
      setError(errorMessage(failure))
      const unknown =
        !(failure instanceof CatalogueError) ||
        failure.status === 0 ||
        failure.status >= 500
      setUncertain(unknown)
      if (!unknown) attempt.current = null
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  function save(path: string, body: Record<string, unknown>, method = "POST") {
    if (attempt.current || busy.current) return
    void send({
      path,
      body: { ...body, requestId: crypto.randomUUID() },
      method,
    })
  }
  function retry() {
    if (attempt.current) void send(attempt.current)
  }
  return { save, retry, pending, error, uncertain }
}
