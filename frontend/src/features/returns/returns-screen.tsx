import { useEffect, useMemo, useState, type FormEvent } from "react"
import {
  Check,
  ClipboardList,
  RotateCcw,
  Search,
  TriangleAlert,
} from "lucide-react"
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
  displayPrice,
  errorMessage,
} from "@/features/catalogue/catalogue-format"
import {
  createReturn,
  getSale,
  getSales,
  ReturnsError,
  type ReturnSale,
  type SaleSummary,
} from "./returns-api"

function parseQuantity(
  value: string,
  unit: ReturnSale["lines"][number]["unit"]
) {
  const decimals = unit === "each" || unit === "pack" ? 0 : 3
  const text = value.trim()
  if (!/^\d+(\.\d+)?$/.test(text)) return null
  const [whole, fraction = ""] = text.split(".")
  if (fraction.length > decimals) return null
  const result =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0")
  return result > 0n ? result : null
}

function quantityText(
  value: number,
  unit: ReturnSale["lines"][number]["unit"]
) {
  if (unit === "each" || unit === "pack") return String(value)
  return (value / 1000).toFixed(3).replace(/\.?0+$/, "")
}

function refundTotal(sale: ReturnSale, quantities: Record<string, string>) {
  let total = 0n
  for (const line of sale.lines) {
    const quantity = parseQuantity(quantities[line.productId] ?? "", line.unit)
    if (quantity === null) {
      if (quantities[line.productId]) return null
      continue
    }
    if (quantity > BigInt(line.availableQuantityMinor)) return null
    const scale = line.unit === "each" || line.unit === "pack" ? 1n : 1000n
    const returned = BigInt(line.returnedQuantityMinor)
    const price = BigInt(line.unitPriceMinor)
    const rounded = (value: bigint) => (value * price + scale / 2n) / scale
    total += rounded(returned + quantity) - rounded(returned)
  }
  return total
}

export function ReturnsScreen() {
  const [sales, setSales] = useState<SaleSummary[]>([])
  const [saleSearch, setSaleSearch] = useState("")
  const [selectedSaleId, setSelectedSaleId] = useState("")
  const [sale, setSale] = useState<ReturnSale | null>(null)
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [reason, setReason] = useState("")
  const [loading, setLoading] = useState(true)
  const [salesError, setSalesError] = useState("")
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState("")
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<{
    saleId: string
    reason: string
    lines: Array<{ productId: string; quantityMinor: string }>
    requestId: string
    uncertain: boolean
  } | null>(null)
  const [submitError, setSubmitError] = useState("")
  const [message, setMessage] = useState("")
  const [reload, setReload] = useState(0)

  const total = useMemo(
    () => (sale ? refundTotal(sale, quantities) : 0n),
    [sale, quantities]
  )
  const selectedSummary = sales.find((item) => item.saleId === selectedSaleId)

  useEffect(() => {
    let current = true
    void getSales("", 0)
      .then((result) => {
        if (!current) return
        setSales(result.sales)
        setSalesError("")
      })
      .catch((failure: unknown) => {
        if (current) setSalesError(errorMessage(failure))
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [reload])

  async function searchSales(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setSalesError("")
    try {
      const result = await getSales(saleSearch.trim(), 0)
      setSales(result.sales)
      setSelectedSaleId("")
      setSale(null)
    } catch (failure: unknown) {
      setSalesError(errorMessage(failure))
    } finally {
      setLoading(false)
    }
  }

  async function selectSale(saleId: string) {
    setSelectedSaleId(saleId)
    setSale(null)
    setQuantities({})
    setPending(null)
    setSubmitError("")
    setDetailError("")
    setDetailLoading(true)
    try {
      setSale(await getSale(saleId))
    } catch (failure: unknown) {
      setDetailError(errorMessage(failure))
    } finally {
      setDetailLoading(false)
    }
  }

  function updateQuantity(productId: string, value: string) {
    setQuantities((current) => ({ ...current, [productId]: value }))
    setSubmitError("")
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!sale || total === null || saving) {
      setSubmitError(
        "Select at least one valid quantity within the remaining refundable balance."
      )
      return
    }
    const lines = sale.lines
      .map((line) => ({
        productId: line.productId,
        quantityMinor: parseQuantity(
          quantities[line.productId] ?? "",
          line.unit
        ),
      }))
      .filter(
        (line): line is { productId: string; quantityMinor: bigint } =>
          line.quantityMinor !== null
      )
      .map((line) => ({
        productId: line.productId,
        quantityMinor: line.quantityMinor.toString(),
      }))
    if (lines.length === 0) {
      setSubmitError(
        "Select at least one valid quantity within the remaining refundable balance."
      )
      return
    }
    const next = pending ?? {
      saleId: sale.saleId,
      reason: reason.trim(),
      lines,
      requestId: crypto.randomUUID(),
      uncertain: false,
    }
    setPending(next)
    setSaving(true)
    setSubmitError("")
    setMessage("")
    try {
      const result = await createReturn({
        saleId: next.saleId,
        reason: next.reason,
        lines: next.lines,
        requestId: next.requestId,
      })
      setMessage(
        `Return ${result.returnId.slice(0, 8)} confirmed for ${displayPrice(String(result.amountMinor))}.`
      )
      setQuantities({})
      setReason("")
      setPending(null)
      await selectSale(next.saleId)
    } catch (failure: unknown) {
      const uncertain = failure instanceof ReturnsError && failure.status === 0
      setPending(uncertain ? { ...next, uncertain: true } : null)
      if (!uncertain) setSubmitError(errorMessage(failure))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p role="status">Loading completed sales…</p>
  if (salesError)
    return (
      <div className="space-y-3">
        <p role="alert">{salesError}</p>
        <Button
          onClick={() => {
            setLoading(true)
            setReload((value) => value + 1)
          }}
        >
          Retry returns
        </Button>
      </div>
    )

  return (
    <section className="space-y-5" aria-label="Returns">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Returns</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Find a completed sale, select the goods coming back, and record the
            refund.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={!sale && !selectedSummary}
          onClick={() => {
            setSale(null)
            setSelectedSaleId("")
            setQuantities({})
            setPending(null)
            setSubmitError("")
          }}
        >
          Start another return
        </Button>
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
      <div className="grid gap-3 sm:grid-cols-3">
        <Summary label="Completed sales" value={String(sales.length)} />
        <Summary
          label="Selected sale"
          value={
            selectedSummary
              ? selectedSummary.saleId.slice(0, 8)
              : "Not selected"
          }
        />
        <Summary
          label="Refund amount"
          value={
            total === null ? "Check lines" : displayPrice(total.toString())
          }
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="size-4" aria-hidden="true" />
              Completed sales
            </CardTitle>
            <CardDescription>
              Recent sales are shown first. Search by the sale ID when a
              customer presents a receipt.
            </CardDescription>
            <form onSubmit={searchSales} className="mt-3 flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search
                  className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  aria-label="Search completed sales"
                  value={saleSearch}
                  onChange={(event) => setSaleSearch(event.target.value)}
                  placeholder="Paste sale ID"
                  className="pl-9"
                />
              </div>
              <Button type="submit">Search</Button>
            </form>
          </CardHeader>
          <CardContent className="p-0">
            {!sales.length ? (
              <div className="m-5 rounded-lg border border-dashed p-6 text-center">
                <RotateCcw
                  className="mx-auto size-7 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="mt-3 font-medium">No completed sales found</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Search again with a completed sale ID.
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {sales.map((item) => (
                  <button
                    type="button"
                    key={item.saleId}
                    className={`flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-muted/50 ${item.saleId === selectedSaleId ? "bg-muted/60" : ""}`}
                    aria-pressed={item.saleId === selectedSaleId}
                    onClick={() => void selectSale(item.saleId)}
                  >
                    <span className="min-w-0">
                      <span className="block font-medium">
                        Sale {item.saleId.slice(0, 8)}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {new Date(item.createdAt).toLocaleString()}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-semibold tabular-nums">
                        {displayPrice(String(item.totalMinor))}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {item.refundableMinor
                          ? `${displayPrice(String(item.refundableMinor))} refundable`
                          : "Fully refunded"}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle>
              {sale ? `Sale ${sale.saleId.slice(0, 8)}` : "Return details"}
            </CardTitle>
            <CardDescription>
              {sale
                ? `${new Date(sale.createdAt).toLocaleString()} · ${displayPrice(String(sale.refundableMinor))} remaining to refund`
                : "Select a completed sale to see its lines."}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {detailLoading ? (
              <p role="status">Loading sale details…</p>
            ) : detailError ? (
              <div className="space-y-2">
                <p role="alert">{detailError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void selectSale(selectedSaleId)}
                >
                  Retry sale details
                </Button>
              </div>
            ) : !sale ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <RotateCcw
                  className="mx-auto size-8 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="mt-3 font-medium">Choose a sale to begin</p>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-3">
                  {sale.lines.map((line) => {
                    const step =
                      line.unit === "each" || line.unit === "pack"
                        ? "1"
                        : "0.001"
                    const available = line.availableQuantityMinor > 0
                    return (
                      <div
                        key={line.productId}
                        className="rounded-lg border p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{line.name}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {line.sku} · {line.unit} ·{" "}
                              {displayPrice(String(line.unitPriceMinor))} per
                              unit
                            </p>
                          </div>
                          <span className="text-right text-xs text-muted-foreground">
                            {available
                              ? `${quantityText(line.availableQuantityMinor, line.unit)} available`
                              : "Already returned"}
                          </span>
                        </div>
                        {available && (
                          <div className="mt-3 space-y-2">
                            <Label htmlFor={`return-${line.productId}`}>
                              Return quantity
                            </Label>
                            <Input
                              id={`return-${line.productId}`}
                              inputMode="decimal"
                              value={
                                pending?.uncertain
                                  ? (pending.lines.find(
                                      (item) =>
                                        item.productId === line.productId
                                    )?.quantityMinor ?? "")
                                  : (quantities[line.productId] ?? "")
                              }
                              onChange={(event) =>
                                updateQuantity(
                                  line.productId,
                                  event.target.value
                                )
                              }
                              placeholder={`Max ${quantityText(line.availableQuantityMinor, line.unit)}`}
                              step={step}
                              disabled={saving || Boolean(pending?.uncertain)}
                            />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="return-reason">Reason for return</Label>
                  <Input
                    id="return-reason"
                    value={pending?.uncertain ? pending.reason : reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="e.g. Customer changed their mind"
                    minLength={3}
                    maxLength={200}
                    disabled={saving || Boolean(pending?.uncertain)}
                    required
                  />
                </div>
                <p className="rounded-lg bg-muted/50 p-3 text-sm">
                  Refund is recorded as paid by the server and stock is returned
                  to the product balance.
                </p>
                {pending?.uncertain && (
                  <p
                    role="alert"
                    className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
                  >
                    <TriangleAlert
                      className="mt-0.5 size-4 shrink-0 text-amber-600"
                      aria-hidden="true"
                    />
                    The return result could not be confirmed. Retry the same
                    return to check whether it was committed.
                  </p>
                )}
                {submitError && !saving && <p role="alert">{submitError}</p>}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Refund total
                    </p>
                    <p className="text-xl font-semibold tabular-nums">
                      {total === null
                        ? "Check lines"
                        : displayPrice(total.toString())}
                    </p>
                  </div>
                  <Button
                    type="submit"
                    disabled={
                      saving ||
                      Boolean(pending && !pending.uncertain) ||
                      total === null ||
                      !Object.values(quantities).some((value) => value.trim())
                    }
                  >
                    {saving
                      ? "Confirming…"
                      : pending?.uncertain
                        ? "Retry same return"
                        : "Confirm return"}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent className="pt-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 truncate text-lg font-semibold tabular-nums">
          {value}
        </p>
      </CardContent>
    </Card>
  )
}
