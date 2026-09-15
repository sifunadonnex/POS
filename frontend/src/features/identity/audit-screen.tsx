import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { listAudit, type AuditEntry } from "./staff-admin-api"
import { errorText } from "./security-form"

export function AuditScreen() {
  const [events, setEvents] = useState<AuditEntry[]>([])
  const [before, setBefore] = useState<string>()
  const [next, setNext] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  useEffect(() => {
    let current = true
    void listAudit(before)
      .then((result) => {
        if (current) {
          setEvents(result.events)
          setNext(result.next)
          setError("")
        }
      })
      .catch((failure: unknown) => {
        if (current) {
          setEvents([])
          setError(errorText(failure))
        }
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [before, revision])
  function refresh() {
    setLoading(true)
    setBefore(undefined)
    setRevision((value) => value + 1)
  }
  return (
    <section className="space-y-5" aria-label="Security history">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Security history</h2>
          <p className="text-sm text-muted-foreground">
            Account changes, authentication events, and email delivery attempts.
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          Refresh
        </Button>
      </div>
      {loading ? (
        <p role="status">Loading security history…</p>
      ) : error ? (
        <div className="space-y-3">
          <p role="alert">{error}</p>
          <Button variant="outline" onClick={refresh}>
            Retry
          </Button>
        </div>
      ) : events.length === 0 ? (
        <p>No security events found.</p>
      ) : (
        <ol className="space-y-2">
          {events.map((event) => (
            <li key={event.id} className="space-y-1 rounded-lg border p-4">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium break-all">
                  {event.action.replaceAll(".", " / ").replaceAll("-", " ")}
                </span>
                <span className="text-sm">{event.outcome}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {new Date(event.createdAt).toLocaleString("en-KE", {
                  timeZone: "Africa/Nairobi",
                })}{" "}
                · Nairobi time · Event {event.id}
              </p>
              <p className="text-xs break-all text-muted-foreground">
                Actor: {event.actorId ?? "Unauthenticated or system"}
                {event.subjectId ? ` · Staff: ${event.subjectId}` : ""}
              </p>
              {event.reason && <p className="text-sm">{event.reason}</p>}
            </li>
          ))}
        </ol>
      )}
      <div className="flex justify-between">
        <Button
          variant="outline"
          disabled={!before || loading}
          onClick={refresh}
        >
          Latest events
        </Button>
        <Button
          variant="outline"
          disabled={!next || loading}
          onClick={() => {
            if (next) {
              setLoading(true)
              setBefore(next)
            }
          }}
        >
          Older events
        </Button>
      </div>
    </section>
  )
}
