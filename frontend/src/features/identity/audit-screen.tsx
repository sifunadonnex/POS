import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RefreshCw, ShieldCheck } from "lucide-react"
import { formatNairobiDateTime } from "@/lib/format"
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
      <div className="flex items-center justify-between gap-3 rounded-xl border bg-card p-5">
        <div>
          <h2 className="text-lg font-semibold">Security history</h2>
          <p className="text-sm text-muted-foreground">
            Account changes, authentication events, and email delivery attempts.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={refresh}
          disabled={loading}
          className="gap-2"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>
      {loading ? (
        <p
          role="status"
          className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground"
        >
          Loading security history…
        </p>
      ) : error ? (
        <div className="space-y-3 rounded-xl border bg-card p-6">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button variant="outline" onClick={refresh}>
            Retry
          </Button>
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center">
          <ShieldCheck
            className="mx-auto mb-3 size-8 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">
            No security events found.
          </p>
        </div>
      ) : (
        <ol className="space-y-3">
          {events.map((event) => (
            <li
              key={event.id}
              className="space-y-2 rounded-xl border bg-card p-5 shadow-xs"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium break-all">
                  {event.action.replaceAll(".", " / ").replaceAll("-", " ")}
                </span>
                <Badge variant="outline">{event.outcome}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatNairobiDateTime(event.createdAt)} · Nairobi time · Event{" "}
                {event.id}
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
