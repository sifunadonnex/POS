import { useEffect, useState, type FormEvent } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatKes } from "@/lib/format"
import { errorMessage } from "../catalogue/catalogue-format"
import { getOperationDocuments, type OperationDocuments } from "./reports-api"

function localDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function quantity(minor: number, unit: string) {
  return `${unit === "kg" || unit === "l" ? (minor / 1000).toFixed(3) : minor} ${unit}`
}

export function StoreDocumentsScreen() {
  const today = localDate(new Date())
  const monthAgo = new Date()
  monthAgo.setDate(monthAgo.getDate() - 30)
  const [from, setFrom] = useState(localDate(monthAgo))
  const [to, setTo] = useState(today)
  const [range, setRange] = useState({ from: localDate(monthAgo), to: today })
  const [page, setPage] = useState(1)
  const [reload, setReload] = useState(0)
  const [report, setReport] = useState<OperationDocuments | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    void getOperationDocuments(range.from, range.to, page, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setReport(value)
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(failure))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [range, page, reload])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!from || !to || from > to) {
      setError("Choose a valid start and end date.")
      return
    }
    setPage(1)
    setReport(null)
    setLoading(true)
    setError("")
    setRange({ from, to })
    setReload((value) => value + 1)
  }

  return (
    <section className="space-y-5" aria-label="Synchronized store documents">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Store documents</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Supplier receipts, supplier returns and stocktake counts received
            from the shop PC.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => {
            setLoading(true)
            setError("")
            setReload((value) => value + 1)
          }}
        >
          Refresh
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        These are synchronized snapshots. Documents still queued on an offline
        shop PC will appear after delivery; compare its pending event count
        before treating this list as complete.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Period</CardTitle>
          <CardDescription>Nairobi calendar dates, inclusive.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="documents-from">From</Label>
              <Input
                id="documents-from"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="documents-to">To</Label>
              <Input
                id="documents-to"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={loading}>
              Run report
            </Button>
          </form>
        </CardContent>
      </Card>
      {loading ? (
        <p role="status">Loading store documents…</p>
      ) : error ? (
        <div role="alert" className="space-y-2">
          <p>{error}</p>
          <Button
            onClick={() => {
              setError("")
              setLoading(true)
              setReload((value) => value + 1)
            }}
          >
            Retry
          </Button>
        </div>
      ) : (
        report && (
          <>
            <p className="text-sm text-muted-foreground">
              {report.storeId
                ? `Synchronized store ${report.storeId.slice(0, 8)} · ${report.total} documents`
                : "No synchronized store configured."}
            </p>
            {report.documents.length === 0 ? (
              <p>No delivered documents in this period.</p>
            ) : (
              <div className="space-y-3">
                {report.documents.map((doc) => (
                  <Card key={doc.eventId}>
                    <CardHeader>
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-base">
                          {doc.eventType === "purchase_receipt.received"
                            ? "Supplier receipt"
                            : doc.eventType === "purchase_return.returned"
                              ? "Supplier return"
                              : "Stocktake count"}
                        </CardTitle>
                        <Badge variant="secondary">
                          {doc.documentId.slice(0, 8)}
                        </Badge>
                      </div>
                      <CardDescription>
                        {new Intl.DateTimeFormat("en-KE", {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: "Africa/Nairobi",
                        }).format(new Date(doc.occurredAt))}
                        {" · "}
                        {doc.actorName}
                        {" · "}
                        {doc.reason}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {doc.eventType === "stocktake.counted" ? (
                        <p>
                          {doc.productName} ({doc.sku}):{" "}
                          {quantity(
                            doc.previousQuantityMinor ?? 0,
                            doc.unit ?? "each"
                          )}
                          {" → "}
                          {quantity(
                            doc.countedQuantityMinor ?? 0,
                            doc.unit ?? "each"
                          )}
                          {" · Change "}
                          {quantity(doc.deltaMinor ?? 0, doc.unit ?? "each")}
                        </p>
                      ) : (
                        <>
                          <p className="font-medium">
                            {doc.supplierName} ·{" "}
                            {formatKes(doc.totalMinor ?? 0)}
                          </p>
                          {doc.receiptId && (
                            <p>Against receipt {doc.receiptId.slice(0, 8)}</p>
                          )}
                          <ul className="space-y-1 text-muted-foreground">
                            {doc.lines.map((line) => (
                              <li key={line.lineId}>
                                {line.productName} ({line.sku}) ·{" "}
                                {quantity(line.quantityMinor, line.unit)} ·{" "}
                                {formatKes(line.lineTotalMinor)}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            {report.total > 50 && (
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  disabled={loading || page === 1}
                  onClick={() => {
                    setPage(page - 1)
                    setLoading(true)
                  }}
                >
                  Previous
                </Button>
                <span>
                  Page {page} of {Math.ceil(report.total / 50)}
                </span>
                <Button
                  variant="outline"
                  disabled={loading || page * 50 >= report.total}
                  onClick={() => {
                    setPage(page + 1)
                    setLoading(true)
                  }}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )
      )}
    </section>
  )
}
