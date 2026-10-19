import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { formatKes, nairobiDay } from "@/lib/format"
import { stockQuantityText } from "../catalogue/catalogue-format"
import {
  getValuation,
  saveOpeningValuation,
  type Valuation,
  type OpeningValuation,
} from "./valuation-api"

export function ValuationPanel({
  allowOpening = false,
}: {
  allowOpening?: boolean
}) {
  const [day, setDay] = useState(nairobiDay),
    [data, setData] = useState<Valuation | null>(null)
  const [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [productId, setProductId] = useState("")
  const [saving, setSaving] = useState(false),
    [pending, setPending] = useState<OpeningValuation | null>(null),
    [message, setMessage] = useState("")
  useEffect(() => {
    let current = true
    getValuation(day)
      .then((value) => {
        if (current) {
          setData(value)
          setError("")
        }
      })
      .catch((failure: unknown) => {
        if (current)
          setError(
            failure instanceof Error ? failure.message : "Valuation unavailable"
          )
      })
    return () => {
      current = false
    }
  }, [day, reload])
  function reloadData() {
    setData(null)
    setError("")
    setReload((n) => n + 1)
  }
  const unknown = data?.products.filter((p) => p.valueMinor === null) ?? []
  const product = unknown.find((p) => p.productId === productId)
  const combinedValue =
    data?.departments.reduce((sum, d) => sum + BigInt(d.stockValueMinor), 0n) ??
    0n
  const combinedProfit = data?.departments.some(
    (d) => d.grossProfitMinor === null
  )
    ? null
    : (data?.departments.reduce(
        (sum, d) => sum + BigInt(d.grossProfitMinor ?? "0"),
        0n
      ) ?? 0n)
  const unvaluedCount =
    data?.departments.reduce((sum, d) => sum + d.unvaluedProducts, 0) ?? 0
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || !product) return
    const form = event.currentTarget,
      fields = new FormData(form)
    const amount = String(fields.get("total") ?? "").trim()
    if (!pending && !/^\d+(\.\d{1,2})?$/.test(amount)) {
      setError("Enter a non-negative KES value with at most two decimals.")
      return
    }
    const [whole, fraction = ""] = amount.split(".")
    const payload = pending ?? {
      requestId: crypto.randomUUID(),
      productId: product.productId,
      expectedQuantityMinor: product.quantityMinor,
      totalValueMinor: (
        BigInt(whole) * 100n +
        BigInt(fraction.padEnd(2, "0"))
      ).toString(),
      reason: String(fields.get("reason")),
    }
    setPending(payload)
    setSaving(true)
    setError("")
    setMessage("")
    try {
      await saveOpeningValuation(payload)
      setMessage("Opening stock value saved.")
      setPending(null)
      setProductId("")
      reloadData()
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Save unconfirmed. Retry the same request."
      )
    } finally {
      setSaving(false)
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock value & gross profit</CardTitle>
        <CardDescription>
          Moving weighted average. Stock value is current; sales and costs use
          the selected Nairobi trading date. Missing costs are never treated as
          zero.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="valuation-day">Costing date</Label>
            <Input
              id="valuation-day"
              type="date"
              value={day}
              onChange={(e) => {
                setData(null)
                setError("")
                setDay(e.target.value)
              }}
            />
          </div>
          <Button variant="outline" onClick={reloadData} disabled={saving}>
            Reload valuation
          </Button>
        </div>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        {!data && !error && <p role="status">Loading stock valuation…</p>}
        {data && data.departments.length === 0 && (
          <p>No stock or trading records in this workspace.</p>
        )}
        {data && data.departments.length > 1 && (
          <dl className="grid gap-2 rounded-lg bg-muted/50 p-4 text-sm sm:grid-cols-2">
            <dt>Combined known stock value</dt>
            <dd>
              {formatKes(combinedValue.toString())} · {unvaluedCount} unvalued
              products
            </dd>
            <dt>Combined gross profit</dt>
            <dd>
              {combinedProfit === null
                ? "Awaiting cost records"
                : formatKes(combinedProfit.toString())}
            </dd>
          </dl>
        )}
        <div className="grid gap-3 xl:grid-cols-2">
          {data?.departments.map((d) => (
            <section
              key={d.departmentId ?? "unassigned"}
              className="space-y-2 rounded-lg border p-4"
              aria-label={d.label}
            >
              <h3 className="font-medium">{d.label}</h3>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt>Known stock value</dt>
                <dd>{formatKes(d.stockValueMinor)}</dd>
                <dt>Unvalued products</dt>
                <dd>{d.unvaluedProducts}</dd>
                <dt>Net sales</dt>
                <dd>{formatKes(d.netSalesMinor)}</dd>
                <dt>Net cost of goods sold</dt>
                <dd>
                  {d.missingCostLines
                    ? "Incomplete"
                    : formatKes(d.netCostMinor)}
                </dd>
                <dt>Gross profit</dt>
                <dd>
                  {d.grossProfitMinor === null
                    ? "Awaiting cost records"
                    : formatKes(d.grossProfitMinor)}
                </dd>
              </dl>
              {d.missingCostLines > 0 && (
                <p className="text-sm text-muted-foreground">
                  {d.missingCostLines} sale/return lines have no historical
                  cost. Opening values do not backfill them.
                </p>
              )}
            </section>
          ))}
        </div>
        {allowOpening && (
          <div className="space-y-3 border-t pt-4">
            <h3 className="font-medium">Opening stock valuation</h3>
            <p className="text-sm text-muted-foreground">
              Enter the total acquisition value of the currently unvalued
              balance, including zero only for genuinely free stock. This can be
              set once for that balance. Shows up to 100 products; assign
              departments first.
            </p>
            <Label htmlFor="valuation-product">Unvalued product</Label>
            <Select
              value={productId || null}
              onValueChange={(v) => setProductId(v ?? "")}
              disabled={saving || Boolean(pending)}
              items={unknown.map((p) => ({
                value: p.productId,
                label: `${p.sku} · ${p.name} · ${p.departmentLabel}`,
              }))}
            >
              <SelectTrigger id="valuation-product" className="w-full">
                <SelectValue placeholder="Choose unvalued stock" />
              </SelectTrigger>
              <SelectContent>
                {unknown.map((p) => (
                  <SelectItem key={p.productId} value={p.productId}>
                    {p.sku} · {p.name} · {p.departmentLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {product && (
              <form onSubmit={(e) => void save(e)} className="space-y-3">
                <p className="text-sm">
                  Current balance:{" "}
                  {stockQuantityText(product.quantityMinor, product.unit)}{" "}
                  {product.unit}
                </p>
                <Label htmlFor="opening-value">Total stock value (KES)</Label>
                <Input
                  id="opening-value"
                  name="total"
                  inputMode="decimal"
                  required
                  disabled={saving || Boolean(pending)}
                />
                <Label htmlFor="opening-cost-reason">
                  Valuation reason / reference
                </Label>
                <Input
                  id="opening-cost-reason"
                  name="reason"
                  required
                  minLength={3}
                  maxLength={200}
                  disabled={saving || Boolean(pending)}
                />
                <Button type="submit" disabled={saving}>
                  {saving
                    ? "Saving…"
                    : pending
                      ? "Retry same opening valuation"
                      : "Save opening valuation"}
                </Button>
                {pending && !saving && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setPending(null)
                      setProductId("")
                      reloadData()
                    }}
                  >
                    Reload balance
                  </Button>
                )}
              </form>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Stock adjustments and supplier-return cost differences are outside
          sales gross profit. Legacy offline records are excluded from this
          local authoritative cost ledger.
        </p>
      </CardContent>
    </Card>
  )
}
