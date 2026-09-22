import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  RefreshCw,
  RotateCcw,
} from "lucide-react"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { errorMessage } from "../catalogue/catalogue-format"
import {
  getSupplierLedger,
  type SupplierLedger,
} from "../purchases/purchases-api"
import {
  getPurchaseReconciliation,
  type PurchaseReconciliation,
} from "./reports-api"

function dateValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function money(minor: number) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 2,
  }).format(minor / 100)
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value))
}

function initialRange() {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 30)
  return { from: dateValue(start), to: dateValue(end) }
}

export function PurchaseReconciliationScreen() {
  const initial = initialRange()
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [appliedRange, setAppliedRange] = useState(initial)
  const [report, setReport] = useState<PurchaseReconciliation | null>(null)
  const [ledger, setLedger] = useState<SupplierLedger | null>(null)
  const [loading, setLoading] = useState(true)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [error, setError] = useState("")
  const [ledgerError, setLedgerError] = useState("")
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void getPurchaseReconciliation(
      appliedRange.from,
      appliedRange.to,
      controller.signal
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setReport(result)
          setLedger(null)
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(failure))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [appliedRange, reloadKey])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!from || !to || from > to) {
      setError("Choose a valid start and end date.")
      return
    }
    setLoading(true)
    setError("")
    setAppliedRange({ from, to })
    setReloadKey((value) => value + 1)
  }

  async function openLedger(supplierId: string) {
    setLedgerLoading(true)
    setLedgerError("")
    try {
      setLedger(
        await getSupplierLedger(supplierId, appliedRange.from, appliedRange.to)
      )
    } catch (failure: unknown) {
      setLedgerError(errorMessage(failure))
    } finally {
      setLedgerLoading(false)
    }
  }

  return (
    <section
      className="space-y-5"
      aria-label="Purchase reconciliation and supplier ledger"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Purchase reconciliation</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Compare supplier receipts with returns and review the net stock
            cost.
          </p>
        </div>
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => {
            setLoading(true)
            setError("")
            setReloadKey((value) => value + 1)
          }}
          disabled={loading}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="size-4" aria-hidden="true" /> Report period
          </CardTitle>
          <CardDescription>
            Calendar dates are inclusive, including both selected days.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="purchase-report-from">From</Label>
              <Input
                id="purchase-report-from"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="purchase-report-to">To</Label>
              <Input
                id="purchase-report-to"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={loading}>
              Run report
            </Button>
            <p className="text-xs text-muted-foreground">
              Showing {appliedRange.from} to {appliedRange.to}
            </p>
          </form>
        </CardContent>
      </Card>

      {loading ? (
        <StateMessage>Loading purchase reconciliation…</StateMessage>
      ) : error ? (
        <StateMessage
          action={
            <Button
              onClick={() => {
                setLoading(true)
                setError("")
                setReloadKey((value) => value + 1)
              }}
            >
              Retry report
            </Button>
          }
        >
          {error}
        </StateMessage>
      ) : report ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Summary
              label="Received"
              value={money(report.summary.receivedTotalMinor)}
              detail={`${report.summary.receiptCount} receipt${report.summary.receiptCount === 1 ? "" : "s"}`}
              icon={ArrowDownLeft}
            />
            <Summary
              label="Supplier returns"
              value={money(report.summary.returnedTotalMinor)}
              detail={`${report.summary.returnCount} return${report.summary.returnCount === 1 ? "" : "s"}`}
              icon={RotateCcw}
            />
            <Summary
              label="Net purchases"
              value={money(report.summary.netPurchasesMinor)}
              detail={`${report.summary.supplierCount} supplier${report.summary.supplierCount === 1 ? "" : "s"}`}
              icon={ArrowUpRight}
            />
            <Summary
              label="Reconciled period"
              value={`${report.from} → ${report.to}`}
              detail="Inclusive date range"
              icon={BookOpen}
            />
          </div>

          <Card>
            <CardHeader className="border-b">
              <CardTitle>Supplier ledger summary</CardTitle>
              <CardDescription>
                Select a supplier to inspect its signed receipt and return
                entries.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {report.suppliers.length === 0 ? (
                <StateMessage>
                  No supplier purchase activity in this period.
                </StateMessage>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Receipts</TableHead>
                      <TableHead>Received</TableHead>
                      <TableHead>Returns</TableHead>
                      <TableHead>Net</TableHead>
                      <TableHead className="text-right">Ledger</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.suppliers.map((supplier) => (
                      <TableRow key={supplier.supplierId}>
                        <TableCell className="font-medium">
                          {supplier.supplierName}
                        </TableCell>
                        <TableCell>{supplier.receiptCount}</TableCell>
                        <TableCell className="tabular-nums">
                          {money(supplier.receivedTotalMinor)}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {money(supplier.returnedTotalMinor)}
                        </TableCell>
                        <TableCell className="font-medium tabular-nums">
                          {money(supplier.netPurchasesMinor)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void openLedger(supplier.supplierId)}
                            disabled={ledgerLoading}
                          >
                            View ledger
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {ledgerError && (
            <p role="alert" className="text-sm">
              {ledgerError}
            </p>
          )}
          {ledger && <LedgerCard ledger={ledger} />}

          <Card>
            <CardHeader className="border-b">
              <CardTitle>Receipt reconciliation</CardTitle>
              <CardDescription>
                Each receipt is reduced by recorded supplier returns against
                that receipt.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {report.receipts.length === 0 ? (
                <StateMessage>No receipts in this period.</StateMessage>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Receipt</TableHead>
                      <TableHead>Lines</TableHead>
                      <TableHead>Received</TableHead>
                      <TableHead>Returned</TableHead>
                      <TableHead>Net</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.receipts.map((receipt) => (
                      <TableRow key={receipt.receiptId}>
                        <TableCell>{shortDate(receipt.createdAt)}</TableCell>
                        <TableCell className="font-medium">
                          {receipt.supplierName}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {receipt.receiptId.slice(0, 8)}
                        </TableCell>
                        <TableCell>{receipt.lineCount}</TableCell>
                        <TableCell className="tabular-nums">
                          {money(receipt.totalMinor)}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {money(receipt.returnedTotalMinor)}
                        </TableCell>
                        <TableCell className="font-medium tabular-nums">
                          {money(receipt.netTotalMinor)}
                        </TableCell>
                        <TableCell className="max-w-56 truncate">
                          {receipt.reason}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </section>
  )
}

function Summary({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string
  value: string
  detail: string
  icon: typeof ArrowDownLeft
}) {
  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div>
          <CardDescription>{label}</CardDescription>
          <CardTitle className="mt-1 text-xl tabular-nums">{value}</CardTitle>
        </div>
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}

function LedgerCard({ ledger }: { ledger: SupplierLedger }) {
  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{ledger.supplier.name} ledger</CardTitle>
            <CardDescription>
              Signed activity from {ledger.from} to {ledger.to}. Receipts
              increase the payable view; returns reduce it.
            </CardDescription>
          </div>
          <Badge variant="secondary">{ledger.entries.length} entries</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {ledger.entries.length === 0 ? (
          <StateMessage>
            No ledger activity for this supplier in the selected period.
          </StateMessage>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Signed amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.entries.map((entry) => (
                <TableRow key={entry.entryId}>
                  <TableCell>{shortDate(entry.createdAt)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        entry.kind === "return" ? "outline" : "secondary"
                      }
                    >
                      {entry.kind === "return" ? "Return" : "Receipt"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {entry.receiptId.slice(0, 8)}
                  </TableCell>
                  <TableCell>{entry.reason}</TableCell>
                  <TableCell
                    className={`text-right font-medium tabular-nums ${entry.signedMinor < 0 ? "text-emerald-700 dark:text-emerald-300" : ""}`}
                  >
                    {money(entry.signedMinor)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function StateMessage({
  children,
  action,
}: {
  children: string
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-28 flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-muted-foreground">{children}</p>
      {action}
    </div>
  )
}
