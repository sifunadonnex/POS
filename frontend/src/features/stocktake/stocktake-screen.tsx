import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Check, ClipboardCheck, Search, TriangleAlert } from "lucide-react"
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
  getStock,
  type InventoryUnit,
  type StockRow,
} from "@/features/inventory/inventory-api"
import { countStock, quantityStep, StocktakeError } from "./stocktake-api"

type PendingCount = {
  productId: string
  quantity: string
  reason: string
  requestId: string
  uncertain: boolean
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request failed. Please retry."
}

function minorFromQuantity(value: string, unit: InventoryUnit) {
  const text = value.trim()
  if (!text || !/^\d+(?:\.\d+)?$/.test(text)) return null
  const [whole, fraction = ""] = text.split(".")
  if ((unit === "each" || unit === "pack") && fraction) return null
  if (fraction.length > 3) return null
  const minorText = `${whole}${fraction.padEnd(3, "0")}`
  const minor = Number(BigInt(minorText))
  return Number.isSafeInteger(minor) ? minor : null
}

function formatQuantity(quantityMinor: number, unit: InventoryUnit) {
  if (unit === "each" || unit === "pack") return String(quantityMinor)
  return (quantityMinor / 1000).toFixed(3).replace(/\.?0+$/, "")
}

function formatDelta(deltaMinor: number, unit: InventoryUnit) {
  if (deltaMinor === 0) return `No change · ${formatQuantity(0, unit)} ${unit}`
  const prefix = deltaMinor > 0 ? "+" : ""
  return `${prefix}${formatQuantity(deltaMinor, unit)} ${unit}`
}

export function StocktakeScreen() {
  const [stock, setStock] = useState<StockRow[]>([])
  const [query, setQuery] = useState({ search: "", page: 0 })
  const [searchValue, setSearchValue] = useState("")
  const [selectedId, setSelectedId] = useState("")
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const [count, setCount] = useState("")
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<PendingCount | null>(null)
  const [submitError, setSubmitError] = useState("")
  const [message, setMessage] = useState("")

  const selected = useMemo(
    () => stock.find((row) => row.productId === selectedId) ?? null,
    [selectedId, stock]
  )
  const countedMinor = selected ? minorFromQuantity(count, selected.unit) : null
  const deltaMinor =
    selected && countedMinor !== null
      ? countedMinor - selected.quantityMinor
      : null
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
            : (result.stock.find((row) => row.active)?.productId ?? "")
        )
        setError("")
      })
      .catch((failure: unknown) => {
        if (!current) return
        setStock([])
        setSelectedId("")
        setError(errorMessage(failure))
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [query, reload])

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
    setCount("")
    setReason("")
    setPending(null)
    setSubmitError("")
    setMessage("")
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected?.active || saving) return
    const next = pending ?? {
      productId: selected.productId,
      quantity: count.trim(),
      reason: reason.trim(),
      requestId: crypto.randomUUID(),
      uncertain: false,
    }
    setPending(next)
    setSaving(true)
    setSubmitError("")
    setMessage("")
    try {
      const result = await countStock({
        productId: next.productId,
        quantity: next.quantity,
        reason: next.reason,
        requestId: next.requestId,
      })
      setStock((rows) =>
        rows.map((row) =>
          row.productId === result.productId
            ? { ...row, quantityMinor: result.quantityMinor }
            : row
        )
      )
      setPending(null)
      setCount("")
      setReason("")
      setSubmitError("")
      setMessage(
        `Stocktake confirmed. Balance is now ${formatQuantity(result.quantityMinor, selected.unit)} ${selected.unit}.`
      )
    } catch (failure: unknown) {
      const uncertain =
        failure instanceof StocktakeError && failure.status === 0
      setPending(uncertain ? { ...next, uncertain: true } : null)
      if (!uncertain) setSubmitError(errorMessage(failure))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-5" aria-label="Stocktake">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Stocktake</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Count what is physically on hand and reconcile one item at a time.
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
        <Summary label="Items on page" value={String(stock.length)} />
        <Summary label="At zero balance" value={String(zeroCount)} />
        <Summary
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
          <Button onClick={refresh}>Retry stocktake</Button>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Products to count</CardTitle>
              <CardDescription>
                Select an active product, then enter the physical quantity.
              </CardDescription>
              <form onSubmit={search} className="mt-3 flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search
                    className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    aria-label="Search stocktake products"
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
                  <ClipboardCheck
                    className="mx-auto size-7 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <h3 className="mt-3 font-medium">No products found</h3>
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
                          {row.active ? "Available to count" : "Archived"}
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

          <Card>
            <CardHeader className="border-b">
              <CardTitle>
                {selected ? selected.name : "Select a product"}
              </CardTitle>
              <CardDescription>
                {selected
                  ? `${selected.sku} · System balance ${formatQuantity(selected.quantityMinor, selected.unit)} ${selected.unit}`
                  : "Choose a product to begin the physical count."}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              {!selected ? (
                <p className="text-sm text-muted-foreground">
                  Select an active product from the list.
                </p>
              ) : !selected.active ? (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                  Archived products cannot be counted.
                </p>
              ) : (
                <form onSubmit={submit} className="space-y-4">
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <p className="text-xs text-muted-foreground">
                      Current system balance
                    </p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">
                      {formatQuantity(selected.quantityMinor, selected.unit)}{" "}
                      {selected.unit}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      The server will calculate and record only the difference.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="physical-count">Physical count</Label>
                    <Input
                      id="physical-count"
                      aria-label="Physical count"
                      inputMode="decimal"
                      value={pending?.uncertain ? pending.quantity : count}
                      onChange={(event) => setCount(event.target.value)}
                      placeholder={
                        selected.unit === "each" || selected.unit === "pack"
                          ? "e.g. 24"
                          : "e.g. 3.250"
                      }
                      min="0"
                      step={quantityStep(selected.unit)}
                      disabled={saving || Boolean(pending?.uncertain)}
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter the full quantity physically on hand, in{" "}
                      {selected.unit}.
                    </p>
                  </div>
                  {deltaMinor !== null && (
                    <div className="flex items-center justify-between rounded-lg border p-3 text-sm">
                      <span>Reconciliation movement</span>
                      <span className="font-semibold tabular-nums">
                        {formatDelta(deltaMinor, selected.unit)}
                      </span>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="stocktake-reason">Reason for count</Label>
                    <Input
                      id="stocktake-reason"
                      aria-label="Reason for count"
                      value={pending?.uncertain ? pending.reason : reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="e.g. Weekly shelf count"
                      minLength={3}
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
                      stocktake to check whether it was committed.
                    </p>
                  )}
                  {submitError && !saving && (
                    <p role="alert" className="text-sm">
                      {submitError}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                    <Badge variant="outline">
                      Manager confirmation required
                    </Badge>
                    <Button
                      type="submit"
                      disabled={
                        saving ||
                        countedMinor === null ||
                        Boolean(pending && !pending.uncertain)
                      }
                    >
                      {saving
                        ? "Confirming…"
                        : pending?.uncertain
                          ? "Retry same stocktake"
                          : "Confirm stocktake"}
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent className="pt-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  )
}
