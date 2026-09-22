import { useEffect, useState, type ReactNode } from "react"
import {
  ArrowDownRight,
  ArrowRight,
  BarChart3,
  Boxes,
  CircleDollarSign,
  ClipboardCheck,
  CreditCard,
  LayoutDashboard,
  PackageCheck,
  PackageOpen,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  ShoppingCart,
  Truck,
  UsersRound,
  WalletCards,
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
import { Separator } from "@/components/ui/separator"
import { getDailySummary, type DailySummary } from "../reports/reports-api"

type DashboardTarget =
  | "sales"
  | "returns"
  | "catalogue"
  | "stock"
  | "purchases"
  | "stocktake"
  | "reports"
  | "account"
  | "staff"

type DashboardScreenProps = {
  manager: boolean
  staffName: string
  onNavigate: (target: DashboardTarget) => void
}

function today() {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

function money(minor: number) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 2,
  }).format(minor / 100)
}

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  tone = "default",
}: {
  title: string
  value: string
  description: string
  icon: LucideIcon
  tone?: "default" | "attention"
}) {
  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div className="min-w-0">
          <CardDescription>{title}</CardDescription>
          <CardTitle className="mt-2 truncate text-2xl tabular-nums">
            {value}
          </CardTitle>
        </div>
        <div
          className={`rounded-xl p-2.5 ${tone === "attention" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-primary/10 text-primary"}`}
        >
          <Icon className="size-5" aria-hidden="true" />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}

function WorkArea({
  icon: Icon,
  title,
  description,
  action,
  label,
  onClick,
}: {
  icon: LucideIcon
  title: string
  description: string
  action: string
  label?: string
  onClick: () => void
}) {
  return (
    <div className="group flex min-h-40 flex-col justify-between rounded-xl border bg-card p-4 shadow-xs transition-colors hover:bg-muted/30">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="rounded-xl bg-muted p-2.5 text-muted-foreground transition-colors group-hover:text-foreground">
            <Icon className="size-4" aria-hidden="true" />
          </div>
          {label && (
            <Badge variant="secondary" className="rounded-full text-[10px]">
              {label}
            </Badge>
          )}
        </div>
        <h3 className="mt-4 font-medium">{title}</h3>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      <Button
        className="mt-5 w-fit gap-1.5 px-0"
        variant="link"
        size="sm"
        onClick={onClick}
      >
        {action}
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  )
}

function SummaryState({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 p-6 text-center">
      <p className="max-w-md text-sm text-muted-foreground">{children}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function DashboardScreen({
  manager,
  staffName,
  onNavigate,
}: DashboardScreenProps) {
  const [summary, setSummary] = useState<DailySummary | null>(null)
  const [loading, setLoading] = useState(manager)
  const [error, setError] = useState("")
  const [reloadKey, setReloadKey] = useState(0)
  const reportDay = today()

  useEffect(() => {
    if (!manager) return
    const controller = new AbortController()
    void getDailySummary(reportDay, controller.signal)
      .then((result) => {
        setSummary(result)
        setError("")
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setSummary(null)
          setError(
            failure instanceof Error
              ? failure.message
              : "The daily summary could not be loaded."
          )
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [manager, reloadKey, reportDay])

  const dateLabel = new Intl.DateTimeFormat("en-KE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date())

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border bg-card shadow-xs">
        <div className="relative overflow-hidden">
          <div
            className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-primary/5 blur-3xl"
            aria-hidden="true"
          />
          <div className="relative flex flex-col gap-6 p-5 sm:p-7 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
                <LayoutDashboard className="size-3.5" aria-hidden="true" />
                Main shop · Command centre
              </div>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                Good morning, {staffName.split(" ")[0]}
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                {manager
                  ? "Review today’s trading position, then move straight into the work that needs attention."
                  : "Your selling, returns and product lookup tools are ready for the next customer."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => onNavigate("sales")} className="gap-2">
                <ShoppingCart className="size-4" aria-hidden="true" />
                New sale
              </Button>
              <Button
                variant="outline"
                onClick={() => onNavigate(manager ? "stock" : "returns")}
                className="gap-2"
              >
                {manager ? (
                  <PackageCheck className="size-4" aria-hidden="true" />
                ) : (
                  <RotateCcw className="size-4" aria-hidden="true" />
                )}
                {manager ? "Review stock" : "Start return"}
              </Button>
            </div>
          </div>
        </div>
        <div className="grid border-t bg-muted/20 sm:grid-cols-3">
          <div className="flex items-center gap-3 border-b p-4 sm:border-r sm:border-b-0">
            <ReceiptText
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <div>
              <p className="text-xs text-muted-foreground">Trading day</p>
              <p className="text-sm font-medium">{dateLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 border-b p-4 sm:border-r sm:border-b-0">
            <PackageOpen
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <div>
              <p className="text-xs text-muted-foreground">Operations</p>
              <p className="text-sm font-medium">
                {manager ? "Sales, stock and purchasing" : "Sales and returns"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-4">
            <ShieldCheck
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <div>
              <p className="text-xs text-muted-foreground">Access</p>
              <p className="text-sm font-medium">
                {manager ? "Manager controls" : "Cashier workspace"}
              </p>
            </div>
          </div>
        </div>
      </section>

      {manager && loading ? (
        <SummaryState>Loading today&apos;s operational summary…</SummaryState>
      ) : manager && error ? (
        <SummaryState
          action={
            <Button
              variant="outline"
              onClick={() => {
                setLoading(true)
                setError("")
                setReloadKey((value) => value + 1)
              }}
              className="gap-2"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry summary
            </Button>
          }
        >
          {error}
        </SummaryState>
      ) : manager && summary ? (
        <section
          aria-label="Today summary"
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
        >
          <StatCard
            title="Sales collected"
            value={money(summary.salesTotalMinor)}
            description={`${summary.saleCount} completed sale${summary.saleCount === 1 ? "" : "s"} today`}
            icon={CircleDollarSign}
          />
          <StatCard
            title="Transactions"
            value={String(summary.saleCount)}
            description={`${summary.paymentCount} payment record${summary.paymentCount === 1 ? "" : "s"} confirmed`}
            icon={ShoppingCart}
          />
          <StatCard
            title="Refunds"
            value={money(summary.refundMinor)}
            description={`${summary.refundCount} refund${summary.refundCount === 1 ? "" : "s"} recorded today`}
            icon={ArrowDownRight}
          />
          <StatCard
            title="Low stock"
            value={String(summary.lowStockCount)}
            description={
              summary.lowStockCount
                ? "Items need replenishment review"
                : "No low-stock items reported"
            }
            icon={PackageOpen}
            tone={summary.lowStockCount ? "attention" : "default"}
          />
        </section>
      ) : (
        <section
          aria-label="Cashier start panel"
          className="grid gap-4 md:grid-cols-2"
        >
          <StatCard
            title="Next customer"
            value="Start sale"
            description="Open the register to scan products and confirm payment."
            icon={ShoppingCart}
          />
          <StatCard
            title="Customer service"
            value="Returns"
            description="Find a completed receipt and record a traceable refund."
            icon={RotateCcw}
          />
        </section>
      )}

      <section className="grid gap-4 xl:grid-cols-[1.45fr_0.85fr]">
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Operational workspace</CardTitle>
                <CardDescription className="mt-1">
                  Open the live workflow you need without leaving the shop view.
                </CardDescription>
              </div>
              <Badge variant="secondary" className="rounded-full">
                {manager ? "Manager view" : "Cashier view"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
            <WorkArea
              icon={ShoppingCart}
              title="Sales register"
              description="Scan products, build a basket and complete a cash sale."
              action="Open register"
              label="Sell"
              onClick={() => onNavigate("sales")}
            />
            <WorkArea
              icon={RotateCcw}
              title="Returns"
              description="Find a completed sale and record a traceable refund."
              action="Find a sale"
              label="Sell"
              onClick={() => onNavigate("returns")}
            />
            <WorkArea
              icon={Boxes}
              title="Product catalogue"
              description="Search current products, prices, units and barcodes."
              action="Browse products"
              label="Inventory"
              onClick={() => onNavigate("catalogue")}
            />
            {manager ? (
              <>
                <WorkArea
                  icon={PackageCheck}
                  title="Stock control"
                  description="Post opening stock, receipts and auditable adjustments."
                  action="Review balances"
                  label="Inventory"
                  onClick={() => onNavigate("stock")}
                />
                <WorkArea
                  icon={Truck}
                  title="Purchase intake"
                  description="Receive supplier goods and add their cost to stock."
                  action="Receive goods"
                  label="Inventory"
                  onClick={() => onNavigate("purchases")}
                />
                <WorkArea
                  icon={ClipboardCheck}
                  title="Stocktake"
                  description="Count physical stock and reconcile the difference."
                  action="Start a count"
                  label="Inventory"
                  onClick={() => onNavigate("stocktake")}
                />
                <WorkArea
                  icon={BarChart3}
                  title="Purchase reports"
                  description="Review supplier ledgers and purchase reconciliation."
                  action="Open reports"
                  label="Insights"
                  onClick={() => onNavigate("reports")}
                />
              </>
            ) : (
              <WorkArea
                icon={ShieldCheck}
                title="My security"
                description="Review your password, MFA and active sessions."
                action="Open security"
                label="Account"
                onClick={() => onNavigate("account")}
              />
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>Payment mix</CardTitle>
                  <CardDescription className="mt-1">
                    Confirmed payments recorded today.
                  </CardDescription>
                </div>
                {manager && summary && (
                  <Badge variant="outline" className="rounded-full">
                    Live
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-5 p-5">
              {manager && summary ? (
                <PaymentMix summary={summary} />
              ) : (
                <SummaryState>
                  {manager
                    ? "Payment totals will appear after the daily summary loads."
                    : "Payment totals and reconciliation are available to managers."}
                </SummaryState>
              )}
            </CardContent>
          </Card>

          {manager && summary ? (
            <Card>
              <CardHeader className="border-b">
                <CardTitle>Shift reconciliation</CardTitle>
                <CardDescription className="mt-1">
                  Drawer position from completed shifts today.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 p-5">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-muted-foreground">
                    Closed shifts
                  </span>
                  <span className="font-medium tabular-nums">
                    {summary.closedShiftCount}
                  </span>
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-muted-foreground">
                    Net variance
                  </span>
                  <span
                    className={`font-medium tabular-nums ${summary.varianceMinor !== 0 ? "text-amber-700 dark:text-amber-300" : ""}`}
                  >
                    {money(summary.varianceMinor)}
                  </span>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  Expected cash is derived from the append-only register
                  movement ledger.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex items-start gap-4 p-5">
                <div className="rounded-xl bg-muted p-2.5 text-muted-foreground">
                  <ReceiptText className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-medium">Register rhythm</p>
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">
                    Scan, review the server total, then confirm the payment
                    shown by the register.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </section>

      <Card className="overflow-hidden">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-primary p-2.5 text-primary-foreground">
              <UsersRound className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="font-medium">
                {manager
                  ? "Staff and access controls"
                  : "Your secure workspace"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {manager
                  ? "Manage staff accounts or review your own sign-in protection."
                  : "Keep your password, MFA and active sessions up to date."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {manager && (
              <Button variant="outline" onClick={() => onNavigate("staff")}>
                Manage staff
              </Button>
            )}
            <Button variant="ghost" onClick={() => onNavigate("account")}>
              My security
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function PaymentMix({ summary }: { summary: DailySummary }) {
  const total = summary.cashMinor + summary.cardMinor + summary.mpesaMinor
  return (
    <>
      <PaymentRow
        icon={WalletCards}
        label="Cash"
        value={summary.cashMinor}
        total={total}
      />
      <PaymentRow
        icon={CreditCard}
        label="Card"
        value={summary.cardMinor}
        total={total}
      />
      <PaymentRow
        icon={CircleDollarSign}
        label="M-Pesa"
        value={summary.mpesaMinor}
        total={total}
      />
      <Separator />
      <div className="flex items-center justify-between text-sm font-medium">
        <span>Total recorded</span>
        <span className="tabular-nums">{money(total)}</span>
      </div>
    </>
  )
}

function PaymentRow({
  icon: Icon,
  label,
  value,
  total,
}: {
  icon: LucideIcon
  label: string
  value: number
  total: number
}) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="size-4" aria-hidden="true" />
          <span>{label}</span>
        </div>
        <div className="text-right">
          <span className="font-medium tabular-nums">{money(value)}</span>
          <span className="ml-2 text-xs text-muted-foreground">{percent}%</span>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
