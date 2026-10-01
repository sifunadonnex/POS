import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import {
  ArrowDownRight,
  BarChart3,
  CalendarDays,
  CircleDollarSign,
  RefreshCw,
  ShoppingCart,
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
import { getSalesInsights, type SalesInsights } from "./reports-api"

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

export function SalesInsightsScreen() {
  const initial = initialRange()
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [appliedRange, setAppliedRange] = useState(initial)
  const [report, setReport] = useState<SalesInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void getSalesInsights(appliedRange.from, appliedRange.to, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setReport(result)
          setError("")
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setReport(null)
          setError(errorMessage(failure))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [appliedRange, reloadKey])

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

function DailySalesChart({ report }: { report: SalesInsights }) {
  const peak = Math.max(0, ...report.daily.map((day) => day.grossSalesMinor))
  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Daily sales</CardTitle>
            <CardDescription className="mt-1">
              Gross completed sales by Nairobi trading day.
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
                    <p className="text-sm font-medium">{cashier.cashierName}</p>
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
                    {product.productName}
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
