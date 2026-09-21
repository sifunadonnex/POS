import { useEffect, useState, type ReactNode } from "react"
import {
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  PackageOpen,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
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

type DashboardTarget = "sales" | "catalogue" | "account" | "staff"

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
    <Card className="min-w-0">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardDescription>{title}</CardDescription>
          <CardTitle className="mt-2 text-2xl tabular-nums">{value}</CardTitle>
        </div>
        <div
          className={`rounded-lg p-2.5 ${tone === "attention" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-primary/10 text-primary"}`}
        >
          <Icon className="size-5" aria-hidden="true" />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}

function WorkArea({
  icon: Icon,
  title,
  description,
  action,
  onClick,
  disabled = false,
}: {
  icon: LucideIcon
  title: string
  description: string
  action: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <div className="flex min-h-36 flex-col justify-between rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-muted p-2 text-muted-foreground">
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h3 className="font-medium">{title}</h3>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <Button
        className="mt-5 w-fit"
        variant={disabled ? "ghost" : "outline"}
        size="sm"
        disabled={disabled}
        onClick={onClick}
      >
        {action}
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
      .then(setSummary)
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
        <div className="flex flex-col gap-6 p-5 sm:p-7 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
              <LayoutDashboard className="size-3.5" aria-hidden="true" />
              Command centre
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Good morning, {staffName.split(" ")[0]}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Keep the shop moving from one connected workspace. {dateLabel}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => onNavigate("sales")} className="gap-2">
              <ShoppingCart className="size-4" aria-hidden="true" />
              New sale
            </Button>
            <Button
              variant="outline"
              onClick={() => onNavigate("catalogue")}
              className="gap-2"
            >
              <Boxes className="size-4" aria-hidden="true" />
              Browse catalogue
            </Button>
          </div>
        </div>
        <div className="grid border-t bg-muted/20 sm:grid-cols-3">
          <div className="flex items-center gap-3 border-b p-4 sm:border-r sm:border-b-0">
            <ReceiptText
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <div>
              <p className="text-xs text-muted-foreground">Primary workflow</p>
              <p className="text-sm font-medium">Sell and reconcile</p>
            </div>
          </div>
          <div className="flex items-center gap-3 border-b p-4 sm:border-r sm:border-b-0">
            <PackageOpen
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <div>
              <p className="text-xs text-muted-foreground">Inventory</p>
              <p className="text-sm font-medium">Catalogue first</p>
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
            title="Sales today"
            value={money(summary.salesTotalMinor)}
            description={`${summary.saleCount} completed sale${summary.saleCount === 1 ? "" : "s"}`}
            icon={CircleDollarSign}
          />
          <StatCard
            title="Transactions"
            value={String(summary.saleCount)}
            description={`${summary.paymentCount} payment record${summary.paymentCount === 1 ? "" : "s"} recorded`}
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
            title="Register"
            value="Ready"
            description="Open the sales register to start a basket."
            icon={ShoppingCart}
          />
          <StatCard
            title="Product lookup"
            value="Catalogue"
            description="Find current products, prices and barcodes."
            icon={Boxes}
          />
        </section>
      )}

      <section className="grid gap-4 xl:grid-cols-[1.4fr_0.9fr]">
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Work areas</CardTitle>
                <CardDescription className="mt-1">
                  Move through the store operations as each module comes online.
                </CardDescription>
              </div>
              <Badge variant="secondary">
                {manager ? "Manager view" : "Cashier view"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
            <WorkArea
              icon={ShoppingCart}
              title="Sales register"
              description="Build a basket, scan products and complete a sale."
              action="Open register"
              onClick={() => onNavigate("sales")}
            />
            <WorkArea
              icon={Boxes}
              title="Product catalogue"
              description="Search products, prices, units and barcodes."
              action="Open catalogue"
              onClick={() => onNavigate("catalogue")}
            />
            <WorkArea
              icon={ClipboardList}
              title="Stock control"
              description="Receiving, adjustments and stocktake are being added next."
              action="Coming next"
              disabled
            />
            <WorkArea
              icon={WalletCards}
              title="Daily reports"
              description={
                manager
                  ? "Today’s manager summary is available above."
                  : "Manager reporting is restricted to managers."
              }
              action={manager ? "Summary above" : "Manager only"}
              disabled
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle>Payment mix</CardTitle>
            <CardDescription className="mt-1">
              Recorded today, when manager summary is available.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            {manager && summary ? (
              <>
                <PaymentRow
                  icon={WalletCards}
                  label="Cash"
                  value={summary.cashMinor}
                />
                <PaymentRow
                  icon={CreditCard}
                  label="Card"
                  value={summary.cardMinor}
                />
                <PaymentRow
                  icon={CircleDollarSign}
                  label="M-Pesa"
                  value={summary.mpesaMinor}
                />
                <Separator />
                <div className="flex items-center justify-between text-sm font-medium">
                  <span>Total recorded</span>
                  <span className="tabular-nums">
                    {money(
                      summary.cashMinor + summary.cardMinor + summary.mpesaMinor
                    )}
                  </span>
                </div>
              </>
            ) : (
              <SummaryState>
                {manager
                  ? "Payment totals will appear after the summary loads."
                  : "Payment totals are available in the manager summary."}
              </SummaryState>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card className="bg-primary text-primary-foreground">
          <CardContent className="flex items-start gap-4 p-5">
            <div className="rounded-lg bg-primary-foreground/10 p-2.5">
              <ArrowUpRight className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium">Next up</p>
              <p className="mt-1 text-sm text-primary-foreground/75">
                {manager
                  ? "Connect stock intake and supplier operations to this workspace."
                  : "Use the register for the next customer sale."}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start gap-4 p-5">
            <div className="rounded-lg bg-muted p-2.5 text-muted-foreground">
              <UsersRound className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium">Need a hand?</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Keep staff access and account security in one place.
              </p>
              <Button
                variant="link"
                className="mt-2 h-auto p-0"
                onClick={() => onNavigate(manager ? "staff" : "account")}
              >
                {manager ? "Manage staff access" : "Open my security"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

function PaymentRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: number
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <span className="font-medium tabular-nums">{money(value)}</span>
    </div>
  )
}
