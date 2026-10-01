import { useEffect, useState, type FormEvent } from "react"
import {
  ChevronLeft,
  ChevronRight,
  ReceiptText,
  Search,
  TriangleAlert,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  displayPrice,
  errorMessage,
} from "@/features/catalogue/catalogue-format"
import {
  getSaleDetail,
  getSalesLedger,
  type PaymentStatus,
  type SaleDetail,
  type SaleLedgerItem,
} from "./sales-api"

function dateInput(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function daysBefore(value: Date, days: number) {
  const result = new Date(value)
  result.setDate(result.getDate() - days)
  return result
}

function paymentBadge(status: PaymentStatus) {
  if (status === "paid") return { label: "Paid", variant: "default" as const }
  if (status === "partial")
    return { label: "Part-paid", variant: "secondary" as const }
  return { label: "Unpaid", variant: "destructive" as const }
}

function paymentMethods(item: SaleLedgerItem) {
  if (!item.paymentKinds.length) return "No confirmed payment"
  return item.paymentKinds
    .map((kind) =>
      kind === "mpesa" ? "M-Pesa" : kind[0].toUpperCase() + kind.slice(1)
    )
    .join(" + ")
}

function quantity(value: number, unit: SaleDetail["lines"][number]["unit"]) {
  const amount = Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/\.?0+$/, "")
  return `${amount} ${unit}`
}

export function SalesHistoryScreen() {
  const currentDay = new Date()
  const initialTo = dateInput(currentDay)
  const initialFrom = dateInput(daysBefore(currentDay, 6))
  const [search, setSearch] = useState("")
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [applied, setApplied] = useState({
    search: "",
    from: initialFrom,
    to: initialTo,
  })
  const [page, setPage] = useState(0)
  const [sales, setSales] = useState<SaleLedgerItem[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState("")
  const [filterError, setFilterError] = useState("")
  const [selectedId, setSelectedId] = useState("")
  const [detail, setDetail] = useState<SaleDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState("")
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let current = true
    void getSalesLedger({ ...applied, page })
      .then((result) => {
        if (!current) return
        setSales(result.sales)
        setHasMore(result.hasMore)
        setListError("")
        setSelectedId("")
        setDetail(null)
      })
      .catch((failure: unknown) => {
        if (current) setListError(errorMessage(failure))
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [applied, page, reload])

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (from > to) {
      setFilterError("Start date must be before the end date.")
      return
    }
    const rangeDays =
      Math.floor(
        (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
          86_400_000
      ) + 1
    if (rangeDays > 93) {
      setFilterError("Sales history is limited to 93 days.")
      return
    }
    setFilterError("")
    setLoading(true)
    setPage(0)
    setApplied({ search: search.trim(), from, to })
  }

  async function selectSale(saleId: string) {
    setSelectedId(saleId)
    setDetail(null)
    setDetailError("")
    setDetailLoading(true)
    try {
      setDetail(await getSaleDetail(saleId))
    } catch (failure: unknown) {
      setDetailError(errorMessage(failure))
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <section aria-label="Sales history" className="space-y-4">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Find completed sales</CardTitle>
          <CardDescription>
            Search by sale reference or cashier. Cashiers only see their own
            sales; managers can review the whole shop.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 pt-1 md:grid-cols-[minmax(0,1fr)_10rem_10rem_auto] md:items-end"
            onSubmit={applyFilters}
          >
            <div className="space-y-2">
              <Label htmlFor="sales-history-search">Sale or cashier</Label>
              <Input
                id="sales-history-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Reference or cashier name"
                maxLength={80}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sales-history-from">From</Label>
              <Input
                id="sales-history-from"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sales-history-to">To</Label>
              <Input
                id="sales-history-to"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                required
              />
            </div>
            <Button type="submit" className="gap-2" disabled={loading}>
              <Search className="size-4" aria-hidden="true" />
              Apply
            </Button>
          </form>
          {filterError && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {filterError}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(20rem,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Sales</CardTitle>
            <CardDescription>
              {applied.from} to {applied.to} · page {page + 1}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <p
                role="status"
                className="py-8 text-center text-muted-foreground"
              >
                Loading sales history…
              </p>
            ) : listError ? (
              <div className="space-y-3 rounded-lg border border-destructive/30 p-4">
                <p role="alert">{listError}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setLoading(true)
                    setReload((value) => value + 1)
                  }}
                >
                  Retry
                </Button>
              </div>
            ) : sales.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <ReceiptText
                  className="mx-auto size-8 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="mt-3 font-medium">No matching sales</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try a wider date range or clear the search.
                </p>
              </div>
            ) : (
              sales.map((sale) => {
                const badge = paymentBadge(sale.paymentStatus)
                return (
                  <button
                    key={sale.saleId}
                    type="button"
                    className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                      selectedId === sale.saleId
                        ? "border-primary bg-primary/5"
                        : "border-border"
                    }`}
                    aria-pressed={selectedId === sale.saleId}
                    onClick={() => void selectSale(sale.saleId)}
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block font-medium">
                          Sale {sale.saleId.slice(0, 8)}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {new Date(sale.createdAt).toLocaleString()} ·{" "}
                          {sale.cashierName}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {sale.lineCount}{" "}
                          {sale.lineCount === 1 ? "line" : "lines"} ·{" "}
                          {paymentMethods(sale)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-semibold tabular-nums">
                          {displayPrice(String(sale.totalMinor))}
                        </span>
                        <span className="mt-1 flex justify-end gap-1">
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                          {sale.refundedMinor > 0 && (
                            <Badge variant="outline">Refunded</Badge>
                          )}
                        </span>
                      </span>
                    </span>
                  </button>
                )
              })
            )}
          </CardContent>
          <CardFooter className="justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true)
                setPage((value) => Math.max(value - 1, 0))
              }}
              disabled={loading || page === 0}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {page + 1}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true)
                setPage((value) => value + 1)
              }}
              disabled={loading || !hasMore}
            >
              Next
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </CardFooter>
        </Card>

        <Card aria-label="Sale details">
          <CardHeader className="border-b">
            <CardTitle>
              {detail ? `Sale ${detail.saleId.slice(0, 8)}` : "Sale details"}
            </CardTitle>
            <CardDescription>
              {detail
                ? `${new Date(detail.createdAt).toLocaleString()} · ${detail.cashierName}`
                : "Select a sale to review its items, payments and refunds."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {detailLoading ? (
              <p
                role="status"
                className="py-8 text-center text-muted-foreground"
              >
                Loading sale details…
              </p>
            ) : detailError ? (
              <div className="space-y-3 rounded-lg border border-destructive/30 p-4">
                <p role="alert">{detailError}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void selectSale(selectedId)}
                >
                  Retry details
                </Button>
              </div>
            ) : !detail ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <ReceiptText
                  className="mx-auto size-8 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="mt-3 font-medium">Choose a sale</p>
              </div>
            ) : (
              <div className="space-y-5">
                <dl className="grid gap-3 sm:grid-cols-3">
                  <Summary label="Sale total" value={detail.totalMinor} />
                  <Summary label="Confirmed paid" value={detail.paidMinor} />
                  <Summary label="Refunded" value={detail.refundedMinor} />
                </dl>
                {detail.balanceMinor > 0 && (
                  <p className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                    <TriangleAlert
                      className="mt-0.5 size-4 shrink-0 text-amber-600"
                      aria-hidden="true"
                    />
                    {displayPrice(String(detail.balanceMinor))} remains unpaid.
                    A receipt is unavailable until confirmed payments cover the
                    sale total.
                  </p>
                )}
                <div>
                  <h3 className="font-medium">Items</h3>
                  <div className="mt-2 divide-y rounded-lg border">
                    {detail.lines.map((line) => (
                      <div
                        key={line.productId}
                        className="flex items-start justify-between gap-3 p-3"
                      >
                        <div>
                          <p className="font-medium">{line.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {line.sku} · {quantity(line.quantity, line.unit)} ×{" "}
                            {displayPrice(String(line.unitPriceMinor))}
                          </p>
                        </div>
                        <p className="shrink-0 font-medium tabular-nums">
                          {displayPrice(String(line.lineTotalMinor))}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="font-medium">Confirmed payments</h3>
                  {detail.payments.length === 0 ? (
                    <p className="mt-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      No confirmed payments yet.
                    </p>
                  ) : (
                    <div className="mt-2 divide-y rounded-lg border">
                      {detail.payments.map((payment) => (
                        <div
                          key={payment.paymentId}
                          className="flex items-start justify-between gap-3 p-3"
                        >
                          <div>
                            <p className="font-medium capitalize">
                              {payment.kind === "mpesa"
                                ? "M-Pesa"
                                : payment.kind}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {new Date(payment.paidAt).toLocaleString()}
                              {payment.changeMinor > 0
                                ? ` · change ${displayPrice(String(payment.changeMinor))}`
                                : ""}
                            </p>
                          </div>
                          <p className="shrink-0 font-medium tabular-nums">
                            {displayPrice(String(payment.amountMinor))}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-semibold tabular-nums">
        {displayPrice(String(value))}
      </dd>
    </div>
  )
}
