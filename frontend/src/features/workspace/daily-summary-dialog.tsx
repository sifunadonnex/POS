import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatKes, nairobiDay } from "@/lib/format"
import { getDailySummary, type DailySummary } from "../reports/reports-api"

export function DailySummaryDialog() {
  const [open, setOpen] = useState(false)
  const [day, setDay] = useState(nairobiDay)
  const [summary, setSummary] = useState<DailySummary | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!open || !day) return
    const controller = new AbortController()
    void getDailySummary(day, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setSummary(value)
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : "Summary unavailable"
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [open, day, revision])
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        if (value) {
          setLoading(true)
          setSummary(null)
          setError("")
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        Daily summary
      </DialogTrigger>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-xl">
        <DialogTitle>Daily summary</DialogTitle>
        <DialogDescription>
          Trading in Africa/Nairobi time, for the selected workspace. Recorded
          sales and collected payments are shown separately.
        </DialogDescription>
        <Label htmlFor="summary-day">Trading date</Label>
        <Input
          id="summary-day"
          type="date"
          value={day}
          onChange={(e) => {
            setDay(e.target.value)
            setLoading(true)
            setSummary(null)
            setError("")
          }}
        />
        {loading && <p role="status">Loading daily summary…</p>}
        {error && (
          <div role="alert">
            <p>{error}</p>
            <Button
              variant="outline"
              onClick={() => {
                setLoading(true)
                setRevision((n) => n + 1)
              }}
            >
              Retry
            </Button>
          </div>
        )}
        {summary && (
          <dl className="divide-y text-sm">
            {[
              ["Completed sales", String(summary.saleCount)],
              ["Sales recorded", formatKes(summary.salesTotalMinor)],
              ["Cash collected", formatKes(summary.cashMinor)],
              ["M-Pesa collected", formatKes(summary.mpesaMinor)],
              ["Card collected", formatKes(summary.cardMinor)],
              ["Refunds paid", formatKes(summary.refundMinor)],
              [
                "Net sales after refunds",
                formatKes(summary.salesTotalMinor - summary.refundMinor),
              ],
              ["Closed shifts", String(summary.closedShiftCount)],
              ["Closing cash variance", formatKes(summary.varianceMinor)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 py-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </DialogContent>
    </Dialog>
  )
}
