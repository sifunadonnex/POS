import { useEffect, useMemo, useState, type FormEvent } from "react"
import {
  Check,
  History,
  PackageCheck,
  Search,
  TriangleAlert,
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
  changeStock,
  getHistory,
  getStock,
  type InventoryUnit,
  type StockAction,
  type StockMovement,
  type StockRow,
} from "./inventory-api"

type PendingChange = {
  action: StockAction
  productId: string
  quantity: string
  reason: string
  requestId: string
  uncertain: boolean
}

const actionDetails: Record<
  StockAction,
  { label: string; description: string; submit: string }
> = {
  opening: {
    label: "Opening stock",
    description: "Add the starting balance for a newly set up item.",
    submit: "Post opening stock",
  },
  receive: {
    label: "Receive stock",
    description: "Add stock received from a supplier or transfer.",
    submit: "Receive stock",
  },
  adjust: {
    label: "Adjust stock",
    description:
      "Correct a counted difference. Use a negative quantity to reduce stock.",
    submit: "Post adjustment",
  },
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request failed. Please retry."
}

function quantityStep(unit: InventoryUnit) {
  return unit === "each" || unit === "pack" ? "1" : "0.001"
}

function formatQuantity(quantityMinor: number, unit: InventoryUnit) {
  if (unit === "each" || unit === "pack") return String(quantityMinor)
  return (quantityMinor / 1000).toFixed(3).replace(/\.?0+$/, "")
}

function formatMovementDelta(deltaMinor: number, unit: InventoryUnit) {
  const prefix = deltaMinor > 0 ? "+" : ""
  return `${prefix}${formatQuantity(deltaMinor, unit)} ${unit}`
}

function movementLabel(kind: StockMovement["kind"]) {
  return kind === "adjustment"
    ? "Adjustment"
    : kind === "stocktake"
      ? "Stocktake"
      : kind === "receive"
        ? "Received"
        : kind === "sale"
          ? "Sale"
          : kind === "return"
            ? "Customer return"
            : "Opening"
}

export function StockControlScreen() {
  const [stock, setStock] = useState<StockRow[]>([])
  const [query, setQuery] = useState({ search: "", page: 0 })
  const [searchValue, setSearchValue] = useState("")
  const [selectedId, setSelectedId] = useState("")
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const [action, setAction] = useState<StockAction>("receive")
  const [quantity, setQuantity] = useState("")
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<PendingChange | null>(null)
  const [submitError, setSubmitError] = useState("")
  const [message, setMessage] = useState("")
  const [history, setHistory] = useState<StockMovement[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState("")
  const [historyReload, setHistoryReload] = useState(0)

  const selected = useMemo(
    () => stock.find((row) => row.productId === selectedId) ?? null,
    [selectedId, stock]
  )
  const zeroCount = stock.filter((row) => row.quantityMinor === 0).length

  useEffect(() => {
    let current = true
    void getStock(query.search, query.page)
      .then((result) => {
        if (!current) return
        setStock(result.stock)
        setHasMore(result.hasMore)
        setSelectedId((old) =>
          result.stock.some((row) => row.productId === old)
            ? old
            : (result.stock[0]?.productId ?? "")
        )
        setHistoryLoading(result.stock.length > 0)
        setHistoryReload((value) => value + 1)
        setError("")
      })
      .catch((failure: unknown) => {
        if (!current) return
        setStock([])
        setSelectedId("")
        setHistoryLoading(false)
        setError(errorMessage(failure))
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [query, reload])

  useEffect(() => {
    if (!selected) return
    let current = true
    void getHistory(selected.productId, 0)
      .then((result) => {
        if (current) {
          setHistory(result.history)
          setHistoryError("")
        }
      })
      .catch((failure: unknown) => {
        if (current) {
          setHistory([])
          setHistoryError(errorMessage(failure))
        }
      })
      .finally(() => {
        if (current) setHistoryLoading(false)
      })
    return () => {
      current = false
    }
  }, [selected, historyReload])

  function refresh() {
    setLoading(true)
    setReload((value) => value + 1)
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setQuery({ search: searchValue.trim(), page: 0 })
  }

  function selectProduct(productId: string) {
    setSelectedId(productId)
    setHistoryLoading(true)
    setQuantity("")
    setReason("")
    setPending(null)
    setSubmitError("")
    setMessage("")
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || !selected.active || saving) return
    const change = pending ?? {
      action,
      productId: selected.productId,
      quantity: quantity.trim(),
      reason: reason.trim(),
      requestId: crypto.randomUUID(),
      uncertain: false,
    }
    setPending(change)
    setSaving(true)
    setSubmitError("")
    setMessage("")
    try {
      const result = await changeStock(change.action, {
        productId: change.productId,
        quantity: change.quantity,
        reason: change.reason,
        requestId: change.requestId,
      })
      setStock((rows) =>
        rows.map((row) =>
          row.productId === result.productId
            ? { ...row, quantityMinor: result.quantityMinor }
            : row
        )
      )
      setPending(null)
      setSubmitError("")
      setQuantity("")
      setReason("")
      setMessage(`${actionDetails[change.action].label} confirmed.`)
      setHistoryLoading(true)
      setHistoryReload((value) => value + 1)
    } catch (failure: unknown) {
      const uncertain =
        failure instanceof Error && "status" in failure && failure.status === 0
      setPending(uncertain ? { ...change, uncertain: true } : null)
      if (!uncertain) setSubmitError(errorMessage(failure))
    } finally {
      setSaving(false)
    }
  }

  function chooseAction(next: StockAction) {
    setAction(next)
    setPending(null)
    setSubmitError("")
    setMessage("")
  }

  return (
    <section className="space-y-5" aria-label="Stock control">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Stock control</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Keep physical stock balances and every movement traceable.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={refresh}
          disabled={loading || saving}
        >
          Refresh balances
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Items on page" value={String(stock.length)} />
        <SummaryCard label="At zero balance" value={String(zeroCount)} />
        <SummaryCard
          label="Page"
          value={`${query.page + 1}${hasMore ? "+" : ""}`}
        />
      </div>

      {message && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm"
        >
          <Check className="size-4 text-emerald-600" aria-hidden="true" />
          {message}
        </p>
      )}
      {loading ? (
        <p role="status">Loading stock balances…</p>
      ) : error ? (
        <div className="space-y-3">
          <p role="alert">{error}</p>
          <Button onClick={refresh}>Retry stock control</Button>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Stock balances</CardTitle>
              <CardDescription>
                Select an item to post a movement or review its audit trail.
              </CardDescription>
              <form onSubmit={search} className="mt-3 flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search
                    className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    aria-label="Search stock"
                    value={searchValue}
                    onChange={(event) => setSearchValue(event.target.value)}
                    placeholder="Search name or SKU"
                    className="pl-9"
                    maxLength={160}
                  />
                </div>
                <Button type="submit">Search</Button>
              </form>
            </CardHeader>
            <CardContent className="p-0">
              {!stock.length ? (
                <div className="m-5 rounded-lg border border-dashed p-6 text-center">
                  <PackageCheck
                    className="mx-auto size-7 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <h3 className="mt-3 font-medium">No stock records found</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Try another product name or SKU.
                  </p>
                </div>
              ) : (
                <div className="divide-y">
                  {stock.map((row) => (
                    <button
                      type="button"
                      key={row.productId}
                      className={`flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/50 ${selectedId === row.productId ? "bg-muted/60" : ""}`}
                      onClick={() => selectProduct(row.productId)}
                      aria-pressed={selectedId === row.productId}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {row.name}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {row.sku} · {row.unit}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-semibold tabular-nums">
                          {formatQuantity(row.quantityMinor, row.unit)}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {row.active ? "Available" : "Archived"}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between border-t px-5 py-3">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={query.page === 0 || loading}
                  onClick={() => {
                    setLoading(true)
                    setQuery((value) => ({ ...value, page: value.page - 1 }))
                  }}
                >
                  Previous
                </Button>
                <span className="text-xs text-muted-foreground">
                  50 items per page
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!hasMore || loading}
                  onClick={() => {
                    setLoading(true)
                    setQuery((value) => ({ ...value, page: value.page + 1 }))
                  }}
                >
                  Next
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader className="border-b">
                <CardTitle>
                  {selected ? selected.name : "Select a product"}
                </CardTitle>
                <CardDescription>
                  {selected
                    ? `${selected.sku} · Current balance ${formatQuantity(selected.quantityMinor, selected.unit)} ${selected.unit}`
                    : "Choose a stock row to manage its balance."}
                </CardDescription>
              </CardHeader>
              {selected && (
                <CardContent className="pt-5">
                  {!selected.active ? (
                    <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                      Archived products cannot receive stock movements.
                    </p>
                  ) : (
                    <>
                      <div
                        className="flex flex-wrap gap-2"
                        aria-label="Stock action"
                      >
                        {(Object.keys(actionDetails) as StockAction[]).map(
                          (value) => (
                            <Button
                              key={value}
                              type="button"
                              size="sm"
                              variant={action === value ? "secondary" : "ghost"}
                              aria-pressed={action === value}
                              onClick={() => chooseAction(value)}
                            >
                              {actionDetails[value].label}
                            </Button>
                          )
                        )}
                      </div>
                      <form onSubmit={submit} className="mt-5 space-y-4">
                        <div className="rounded-lg bg-muted/50 p-3 text-sm">
                          <p className="font-medium">
                            {actionDetails[action].label}
                          </p>
                          <p className="mt-1 text-muted-foreground">
                            {actionDetails[action].description}
                          </p>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="stock-quantity">
                            Quantity ({selected.unit})
                          </Label>
                          <Input
                            id="stock-quantity"
                            inputMode="decimal"
                            value={
                              pending?.uncertain ? pending.quantity : quantity
                            }
                            onChange={(event) =>
                              setQuantity(event.target.value)
                            }
                            placeholder={
                              action === "adjust" ? "e.g. -2 or 4" : "e.g. 12"
                            }
                            step={quantityStep(selected.unit)}
                            disabled={saving || Boolean(pending?.uncertain)}
                            required
                          />
                          <p className="text-xs text-muted-foreground">
                            Step: {quantityStep(selected.unit)} {selected.unit}.
                            The server validates the final balance.
                          </p>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="stock-reason">
                            Reason for change
                          </Label>
                          <Input
                            id="stock-reason"
                            value={pending?.uncertain ? pending.reason : reason}
                            onChange={(event) => setReason(event.target.value)}
                            placeholder="e.g. Delivery note 1042"
                            maxLength={200}
                            disabled={saving || Boolean(pending?.uncertain)}
                            required
                          />
                        </div>
                        {pending?.uncertain && (
                          <p
                            role="alert"
                            className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
                          >
                            <TriangleAlert
                              className="mt-0.5 size-4 shrink-0 text-amber-600"
                              aria-hidden="true"
                            />
                            The result could not be confirmed. Retry the same
                            stock change to check whether it was committed.
                          </p>
                        )}
                        {submitError && !saving && (
                          <p role="alert">{submitError}</p>
                        )}
                        <Button
                          type="submit"
                          disabled={
                            saving || Boolean(pending && !pending.uncertain)
                          }
                        >
                          {saving
                            ? "Confirming…"
                            : pending?.uncertain
                              ? "Retry same stock change"
                              : actionDetails[action].submit}
                        </Button>
                      </form>
                    </>
                  )}
                </CardContent>
              )}
            </Card>

            <Card>
              <CardHeader className="border-b">
                <CardTitle className="flex items-center gap-2">
                  <History className="size-4" aria-hidden="true" />
                  Movement history
                </CardTitle>
                <CardDescription>
                  Append-only record for the selected product.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                {!selected ? (
                  <p className="text-sm text-muted-foreground">
                    Select a product to view its history.
                  </p>
                ) : historyLoading ? (
                  <p role="status" className="text-sm">
                    Loading movement history…
                  </p>
                ) : historyError ? (
                  <div className="space-y-2">
                    <p role="alert" className="text-sm">
                      {historyError}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setHistoryLoading(true)
                        setHistoryReload((value) => value + 1)
                      }}
                    >
                      Retry history
                    </Button>
                  </div>
                ) : !history.length ? (
                  <p className="text-sm text-muted-foreground">
                    No movements have been posted for this product.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {history.map((movement) => (
                      <div
                        key={movement.id}
                        className="flex items-start justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">
                              {movementLabel(movement.kind)}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {movement.actorName}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-sm">
                            {movement.reason}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {new Date(movement.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-medium tabular-nums">
                            {formatMovementDelta(
                              movement.deltaMinor,
                              selected.unit
                            )}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                            Balance{" "}
                            {formatQuantity(
                              movement.quantityAfterMinor,
                              selected.unit
                            )}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </section>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent className="pt-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  )
}
