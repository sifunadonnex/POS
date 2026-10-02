import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import {
  ArrowDownRight,
  BarChart3,
  CalendarDays,
  CircleDollarSign,
  Cloud,
  Clock3,
  RefreshCw,
  ShoppingCart,
  TriangleAlert,
  UsersRound,
  type LucideIcon,
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
import { formatKes } from "@/lib/format"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { errorMessage } from "../catalogue/catalogue-format"
import { DailySalesBars } from "./daily-sales-bars"
import {
  getSalesInsights,
  type SalesInsights,
  type SalesSourceOption,
} from "./reports-api"

function dateValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function initialRange() {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 13)
  return { from: dateValue(start), to: dateValue(end) }
}

function money(minor: number) {
  return formatKes(minor)
}

function quantity(value: number, unit: "each" | "pack" | "kg" | "l") {
  const amount = unit === "kg" || unit === "l" ? value / 1000 : value
  return `${new Intl.NumberFormat("en-KE", { maximumFractionDigits: 3 }).format(amount)} ${unit}`
}

function sourceKey(source: SalesSourceOption) {
  return `${source.source}:${source.storeId ?? ""}`
}

function sourceLabel(
  report: SalesInsights,
  source: "operational" | "edge",
  storeId: string | null
) {
  return (
    report.availableSources.find(
      (option) => option.source === source && option.storeId === storeId
    )?.label ?? (source === "edge" ? "Synchronized store" : "Operational")
  )
}

export function SalesInsightsScreen() {
  const initial = initialRange()
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [appliedRange, setAppliedRange] = useState(initial)
  const [report, setReport] = useState<SalesInsights | null>(null)
  const [appliedSource, setAppliedSource] = useState<SalesSourceOption | null>(
    null
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void getSalesInsights(
      appliedRange.from,
      appliedRange.to,
      appliedSource ?? undefined,
      controller.signal
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setReport(result)
          setError("")
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(failure))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [appliedRange, appliedSource, reloadKey])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const days =
      Math.round(
        (Date.parse(`${to}T00:00:00.000Z`) -
          Date.parse(`${from}T00:00:00.000Z`)) /
          86_400_000
      ) + 1
    if (!from || !to || from > to || !Number.isFinite(days)) {
      setError("Choose a valid start and end date.")
      return
    }
    if (days > 93) {
      setError("Sales insights can cover at most 93 days at a time.")
      return
    }
    setLoading(true)
    setError("")
    setAppliedRange({ from, to })
    setReloadKey((value) => value + 1)
  }

  function reload() {
    setLoading(true)
    setError("")
    setReloadKey((value) => value + 1)
  }

  function selectSource(source: SalesSourceOption) {
    const current = appliedSource ?? report?.scope
    if (current && sourceKey(source) === sourceKey(current)) return
    setLoading(true)
    setError("")
    setAppliedSource(source)
  }

  return (
    <section className="space-y-5" aria-label="Sales insights">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Sales insights</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Track daily trading, cashier performance, payment mix and the
            products driving revenue.
          </p>
        </div>
        <Button
          variant="outline"
          className="gap-2"
          onClick={reload}
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
            Choose up to 93 inclusive calendar days in the shop&apos;s Nairobi
            trading timezone.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="sales-report-from">From</Label>
              <Input
                id="sales-report-from"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sales-report-to">To</Label>
              <Input
                id="sales-report-to"
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
          {report && report.availableSources.length > 1 ? (
            <div className="mt-4 border-t pt-4">
              <p className="text-sm font-medium">Sales source</p>
              <div
                className="mt-2 flex flex-wrap gap-2"
                aria-label="Sales source"
              >
                {report.availableSources.map((source) => (
                  <Button
                    key={sourceKey(source)}
                    type="button"
                    size="sm"
                    variant={
                      sourceKey(source) ===
                      sourceKey(appliedSource ?? report.scope)
                        ? "secondary"
                        : "outline"
                    }
                    aria-pressed={
                      sourceKey(source) ===
                      sourceKey(appliedSource ?? report.scope)
                    }
                    disabled={loading}
                    onClick={() => selectSource(source)}
                  >
                    {source.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {loading ? (
        <StateMessage>Loading sales insights…</StateMessage>
      ) : error ? (
        <StateMessage action={<Button onClick={reload}>Retry report</Button>}>
          {error}
        </StateMessage>
      ) : report ? (
        <SalesReport report={report} />
      ) : null}
    </section>
  )
}

function SalesReport({ report }: { report: SalesInsights }) {
  return (
    <>
      <ReportingStatus report={report} />

      {report.coverage.synchronizedReturns === "not_available" ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/35 bg-amber-500/5 p-4 text-sm">
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400"
            aria-hidden="true"
          />
          <div>
            <p className="font-medium">Edge returns are not included yet</p>
            <p className="mt-1 text-muted-foreground">
              Synchronized figures currently include completed cash sales.
              Refund and net-sales figures are incomplete when an edge source is
              selected.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Net sales"
          value={money(report.summary.netSalesMinor)}
          detail={`${report.summary.saleCount} completed sale${report.summary.saleCount === 1 ? "" : "s"}`}
          icon={CircleDollarSign}
        />
        <SummaryCard
          label="Average basket"
          value={money(report.summary.averageBasketMinor)}
          detail="Gross sales divided by completed sales"
          icon={ShoppingCart}
        />
        <SummaryCard
          label="Refunds"
          value={money(report.summary.refundMinor)}
          detail={`${report.summary.refundCount} paid refund${report.summary.refundCount === 1 ? "" : "s"}`}
          icon={ArrowDownRight}
        />
        <SummaryCard
          label="Active cashiers"
          value={String(report.summary.activeCashierCount)}
          detail={`${report.days}-day reporting period`}
          icon={UsersRound}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_0.8fr]">
        <DailySalesChart report={report} />
        <PaymentMix report={report} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <CashierPerformance report={report} />
        <TopProducts report={report} />
      </div>
    </>
  )
}

function ReportingStatus({ report }: { report: SalesInsights }) {
  const lag = report.reportingLag
  const missing = Math.max(0, lag.receivedEvents - lag.projectedEvents)
  const message =
    lag.status === "not_configured"
      ? "Cloud synchronization is not configured for this runtime."
      : lag.pendingEvents > 0
        ? `${lag.pendingEvents} completed sale${lag.pendingEvents === 1 ? " is" : "s are"} waiting to upload.`
        : missing > 0
          ? `${missing} received sale${missing === 1 ? " is" : "s are"} waiting for reporting projection.`
          : lag.receivedEvents > 0
            ? `${lag.projectedEvents} synchronized sale${lag.projectedEvents === 1 ? " is" : "s are"} available in reports.`
            : "Synchronization reporting is current; no edge sales have been received yet."
  return (
    <Card size="sm">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            {lag.status === "lagging" ? (
              <Clock3 className="size-4" aria-hidden="true" />
            ) : (
              <Cloud className="size-4" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">{report.scope.label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{message}</p>
          </div>
        </div>
        <Badge variant={lag.status === "lagging" ? "destructive" : "secondary"}>
          {lag.status === "lagging"
            ? "Reporting delayed"
            : lag.status === "not_configured"
              ? "Sync not configured"
              : "Reporting current"}
        </Badge>
      </CardContent>
    </Card>
  )
}

function DailySalesChart({ report }: { report: SalesInsights }) {
  const peak = Math.max(0, ...report.daily.map((day) => day.grossSalesMinor))
  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Daily sales</CardTitle>
            <CardDescription className="mt-1">
              Gross completed sales by Nairobi trading day ·{" "}
              {report.scope.label}.
            </CardDescription>
          </div>
          <Badge variant="secondary">Peak {money(peak)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-5">
        {report.daily.length === 0 ? (
          <StateMessage>No daily sales in this period.</StateMessage>
        ) : (
          <div aria-labelledby="daily-sales-chart-title">
            <p id="daily-sales-chart-title" className="sr-only">
              Daily gross sales and refunds from {report.from} to {report.to}
            </p>
            <DailySalesBars daily={report.daily} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PaymentMix({ report }: { report: SalesInsights }) {
  const labels = { cash: "Cash", card: "Card", mpesa: "M-Pesa" } as const
  const rows = (["cash", "card", "mpesa"] as const).map(
    (kind) =>
      report.paymentMix.find((payment) => payment.kind === kind) ?? {
        kind,
        paymentCount: 0,
        amountMinor: 0,
      }
  )
  const total = rows.reduce((sum, row) => sum + row.amountMinor, 0)
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Payment mix</CardTitle>
        <CardDescription className="mt-1">
          Confirmed tender collected in the selected period.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 p-5">
        {rows.map((row) => {
          const percent = total
            ? Math.round((row.amountMinor / total) * 100)
            : 0
          return (
            <div key={row.kind} className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  {labels[row.kind]} · {row.paymentCount}
                </span>
                <span className="font-medium tabular-nums">
                  {money(row.amountMinor)} · {percent}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          )
        })}
        <div className="flex items-center justify-between border-t pt-4 text-sm font-medium">
          <span>Total collected</span>
          <span className="tabular-nums">{money(total)}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function CashierPerformance({ report }: { report: SalesInsights }) {
  const maximum = Math.max(
    1,
    ...report.cashiers.map((cashier) => Math.max(cashier.netSalesMinor, 0))
  )
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Sales by cashier</CardTitle>
        <CardDescription className="mt-1">
          Net sales attributed to the staff member who completed each sale.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 p-5">
        {report.cashiers.length === 0 ? (
          <StateMessage>No cashier sales in this period.</StateMessage>
        ) : (
          report.cashiers.map((cashier) => {
            const percent = Math.max(
              0,
              Math.round((cashier.netSalesMinor / maximum) * 100)
            )
            return (
              <div key={cashier.cashierId} className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">
                        {cashier.cashierName}
                      </p>
                      <Badge variant="outline">
                        {sourceLabel(report, cashier.source, cashier.storeId)}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {cashier.saleCount} sales · Avg{" "}
                      {money(cashier.averageBasketMinor)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium tabular-nums">
                      {money(cashier.netSalesMinor)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {money(cashier.refundMinor)} refunded
                    </p>
                  </div>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

function TopProducts({ report }: { report: SalesInsights }) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Top products</CardTitle>
        <CardDescription className="mt-1">
          Products ranked by gross sales value before refunds.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {report.topProducts.length === 0 ? (
          <StateMessage>No product sales in this period.</StateMessage>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Sales</TableHead>
                <TableHead className="text-right">Gross value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.topProducts.map((product) => (
                <TableRow key={product.productId}>
                  <TableCell className="font-medium">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{product.productName}</span>
                      <Badge variant="outline">
                        {sourceLabel(report, product.source, product.storeId)}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {quantity(product.quantityMinor, product.unit)}
                  </TableCell>
                  <TableCell>{product.saleCount}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {money(product.grossSalesMinor)}
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

function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string
  value: string
  detail: string
  icon: LucideIcon
}) {
  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div className="min-w-0">
          <CardDescription>{label}</CardDescription>
          <CardTitle className="mt-1 truncate text-xl tabular-nums">
            {value}
          </CardTitle>
        </div>
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Icon className="size-4" aria-hidden="true" />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}

function StateMessage({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-muted/20 p-6 text-center">
      <div className="rounded-full bg-muted p-2.5 text-muted-foreground">
        <BarChart3 className="size-5" aria-hidden="true" />
      </div>
      <p className="max-w-md text-sm text-muted-foreground">{children}</p>
      {action}
    </div>
  )
}
