import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Check, PackagePlus, Search, Truck, TriangleAlert } from "lucide-react"
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
import { getProducts, type Product } from "@/features/catalogue/catalogue-api"
import {
  displayPrice,
  errorMessage,
} from "@/features/catalogue/catalogue-format"
import {
  createSupplier,
  getSuppliers,
  receivePurchase,
  PurchaseError,
  type Supplier,
} from "./purchases-api"

type PurchaseLine = {
  product: Product
  quantity: string
  unitCost: string
}

type PendingReceipt = {
  supplierId: string
  reason: string
  lines: Array<{ productId: string; quantity: string; unitCostMinor: string }>
  requestId: string
  uncertain: boolean
}

function parseMinor(value: string, decimals: number) {
  const text = value.trim()
  if (!/^\d+(\.\d+)?$/.test(text)) return null
  const [whole, fraction = ""] = text.split(".")
  if (fraction.length > decimals) return null
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0")
  )
}

function quantityMinor(value: string, product: Product) {
  const decimals = product.unit === "each" || product.unit === "pack" ? 0 : 3
  const parsed = parseMinor(value, decimals)
  if (parsed === null || parsed <= 0n) return null
  return parsed
}

function costMinor(value: string) {
  const parsed = parseMinor(value, 2)
  return parsed === null || parsed < 0n ? null : parsed
}

function lineTotalMinor(line: PurchaseLine) {
  const quantity = quantityMinor(line.quantity, line.product)
  const cost = costMinor(line.unitCost)
  if (quantity === null || cost === null) return null
  const total =
    line.product.unit === "each" || line.product.unit === "pack"
      ? quantity * cost
      : (quantity * cost) / 1000n
  if (
    line.product.unit !== "each" &&
    line.product.unit !== "pack" &&
    (quantity * cost) % 1000n !== 0n
  ) {
    return null
  }
  return total
}

function totalText(total: bigint | null) {
  return total === null ? "—" : displayPrice(total.toString())
}

export function PurchaseIntakeScreen() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [supplierSearch, setSupplierSearch] = useState("")
  const [productSearch, setProductSearch] = useState("")
  const [selectedSupplierId, setSelectedSupplierId] = useState("")
  const [lines, setLines] = useState<PurchaseLine[]>([])
  const [reason, setReason] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [productLoading, setProductLoading] = useState(false)
  const [productError, setProductError] = useState("")
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<PendingReceipt | null>(null)
  const [submitError, setSubmitError] = useState("")
  const [message, setMessage] = useState("")
  const [supplierFormOpen, setSupplierFormOpen] = useState(false)
  const [supplierName, setSupplierName] = useState("")
  const [supplierReason, setSupplierReason] = useState("")
  const [supplierSaving, setSupplierSaving] = useState(false)
  const [supplierError, setSupplierError] = useState("")

  const selectedSupplier = suppliers.find(
    (supplier) => supplier.id === selectedSupplierId
  )
  const total = useMemo(() => {
    let sum = 0n
    for (const line of lines) {
      const lineTotal = lineTotalMinor(line)
      if (lineTotal === null) return null
      sum += lineTotal
    }
    return sum
  }, [lines])
  const availableProducts = products.filter(
    (product) =>
      !lines.some((line) => line.product.id === product.id) &&
      `${product.name} ${product.sku}`
        .toLowerCase()
        .includes(productSearch.toLowerCase())
  )

  useEffect(() => {
    let current = true
    void Promise.all([
      getSuppliers(),
      getProducts({ search: "", status: "active", categoryId: "", page: 0 }),
    ])
      .then(([supplierResult, productResult]) => {
        if (!current) return
        setSuppliers(supplierResult.suppliers)
        setProducts(productResult.products)
        setSelectedSupplierId(supplierResult.suppliers[0]?.id ?? "")
        setError("")
      })
      .catch((failure: unknown) => {
        if (current) setError(errorMessage(failure))
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [])

  async function searchProducts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setProductLoading(true)
    setProductError("")
    try {
      const result = await getProducts({
        search: productSearch.trim(),
        status: "active",
        categoryId: "",
        page: 0,
      })
      setProducts(result.products)
    } catch (failure: unknown) {
      setProductError(errorMessage(failure))
    } finally {
      setProductLoading(false)
    }
  }

  function addProduct(product: Product) {
    setLines((current) => [...current, { product, quantity: "", unitCost: "" }])
    setProductSearch("")
  }

  function updateLine(
    productId: string,
    field: "quantity" | "unitCost",
    value: string
  ) {
    setLines((current) =>
      current.map((line) =>
        line.product.id === productId ? { ...line, [field]: value } : line
      )
    )
    setSubmitError("")
  }

  function removeLine(productId: string) {
    setLines((current) =>
      current.filter((line) => line.product.id !== productId)
    )
  }

  async function saveSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSupplierSaving(true)
    setSupplierError("")
    try {
      const supplier = await createSupplier({
        name: supplierName.trim(),
        reason: supplierReason.trim(),
        requestId: crypto.randomUUID(),
      })
      setSuppliers((current) =>
        [...current, supplier].sort((a, b) => a.name.localeCompare(b.name))
      )
      setSelectedSupplierId(supplier.id)
      setSupplierName("")
      setSupplierReason("")
      setSupplierFormOpen(false)
    } catch (failure: unknown) {
      setSupplierError(errorMessage(failure))
    } finally {
      setSupplierSaving(false)
    }
  }

  async function submitReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedSupplierId || !lines.length || total === null || saving) {
      setSubmitError(
        "Choose a supplier, add at least one valid line, and use exact unit costs."
      )
      return
    }
    const next = pending ?? {
      supplierId: selectedSupplierId,
      reason: reason.trim(),
      lines: lines.map((line) => ({
        productId: line.product.id,
        quantity: line.quantity.trim(),
        unitCostMinor: costMinor(line.unitCost)?.toString() ?? "",
      })),
      requestId: crypto.randomUUID(),
      uncertain: false,
    }
    setPending(next)
    setSaving(true)
    setSubmitError("")
    setMessage("")
    try {
      const result = await receivePurchase({
        supplierId: next.supplierId,
        reason: next.reason,
        requestId: next.requestId,
        lines: next.lines,
      })
      setMessage(
        `Receipt ${result.receiptId.slice(0, 8)} confirmed for ${displayPrice(String(result.totalMinor))}.`
      )
      setLines([])
      setReason("")
      setPending(null)
    } catch (failure: unknown) {
      const uncertain = failure instanceof PurchaseError && failure.status === 0
      setPending(uncertain ? { ...next, uncertain: true } : null)
      if (!uncertain) setSubmitError(errorMessage(failure))
    } finally {
      setSaving(false)
    }
  }

  function resetForm() {
    setLines([])
    setReason("")
    setPending(null)
    setSubmitError("")
    setMessage("")
  }

  if (loading) return <p role="status">Loading purchase intake…</p>
  if (error) {
    return (
      <div className="space-y-3" role="alert">
        <p>{error}</p>
        <Button onClick={() => window.location.reload()}>
          Retry purchase intake
        </Button>
      </div>
    )
  }

  return (
    <section className="space-y-5" aria-label="Purchase intake">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Purchase intake</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Receive supplier goods into stock with a traceable cost record.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={resetForm}
          disabled={saving || !lines.length}
        >
          Clear receipt
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
        <Summary
          label="Supplier"
          value={selectedSupplier?.name ?? "Not selected"}
        />
        <Summary label="Receipt lines" value={String(lines.length)} />
        <Summary label="Receipt total" value={totalText(total)} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <Truck className="size-4" aria-hidden="true" /> Supplier
              </CardTitle>
              <CardDescription>
                Select the supplier named on the delivery.
              </CardDescription>
              <div className="relative mt-3">
                <Search
                  className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  aria-label="Search suppliers"
                  value={supplierSearch}
                  onChange={(event) => setSupplierSearch(event.target.value)}
                  placeholder="Search suppliers"
                  className="pl-9"
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              <div className="flex flex-wrap gap-2">
                {suppliers
                  .filter((supplier) =>
                    supplier.name
                      .toLowerCase()
                      .includes(supplierSearch.toLowerCase())
                  )
                  .map((supplier) => (
                    <Button
                      key={supplier.id}
                      type="button"
                      size="sm"
                      variant={
                        selectedSupplierId === supplier.id
                          ? "secondary"
                          : "outline"
                      }
                      aria-pressed={selectedSupplierId === supplier.id}
                      onClick={() => setSelectedSupplierId(supplier.id)}
                    >
                      {supplier.name}
                    </Button>
                  ))}
              </div>
              {!suppliers.length && (
                <p className="text-sm text-muted-foreground">
                  No suppliers yet. Add the first supplier below.
                </p>
              )}
              {suppliers.length > 0 &&
                !suppliers.some((supplier) =>
                  supplier.name
                    .toLowerCase()
                    .includes(supplierSearch.toLowerCase())
                ) && (
                  <p className="text-sm text-muted-foreground">
                    No matching suppliers.
                  </p>
                )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSupplierFormOpen((value) => !value)}
              >
                {supplierFormOpen ? "Cancel new supplier" : "Add new supplier"}
              </Button>
              {supplierFormOpen && (
                <form
                  onSubmit={saveSupplier}
                  className="space-y-3 rounded-lg border bg-muted/30 p-3"
                >
                  <div className="space-y-2">
                    <Label htmlFor="supplier-name">Supplier name</Label>
                    <Input
                      id="supplier-name"
                      value={supplierName}
                      onChange={(event) => setSupplierName(event.target.value)}
                      minLength={2}
                      maxLength={200}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="supplier-reason">
                      Reason for adding supplier
                    </Label>
                    <Input
                      id="supplier-reason"
                      value={supplierReason}
                      onChange={(event) =>
                        setSupplierReason(event.target.value)
                      }
                      minLength={3}
                      maxLength={200}
                      required
                    />
                  </div>
                  {supplierError && (
                    <p role="alert" className="text-sm">
                      {supplierError}
                    </p>
                  )}
                  <Button type="submit" disabled={supplierSaving}>
                    {supplierSaving ? "Saving…" : "Save supplier"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle>Add products</CardTitle>
              <CardDescription>
                Search the active catalogue and add each product once.
              </CardDescription>
              <form onSubmit={searchProducts} className="mt-3 flex gap-2">
                <Input
                  aria-label="Search products for receipt"
                  value={productSearch}
                  onChange={(event) => setProductSearch(event.target.value)}
                  placeholder="Search product or SKU"
                  maxLength={160}
                />
                <Button type="submit" disabled={productLoading}>
                  {productLoading ? "Searching…" : "Search"}
                </Button>
              </form>
            </CardHeader>
            <CardContent className="p-0">
              {productError ? (
                <div className="space-y-2 p-5">
                  <p role="alert">{productError}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void searchProducts(
                        new Event(
                          "submit"
                        ) as unknown as FormEvent<HTMLFormElement>
                      )
                    }
                  >
                    Retry products
                  </Button>
                </div>
              ) : !availableProducts.length ? (
                <p className="p-5 text-sm text-muted-foreground">
                  No products available to add.
                </p>
              ) : (
                <div className="divide-y">
                  {availableProducts.slice(0, 12).map((product) => (
                    <button
                      type="button"
                      key={product.id}
                      className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-muted/50"
                      onClick={() => addProduct(product)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {product.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {product.sku} · {product.unit}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        Add
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <PackagePlus className="size-4" aria-hidden="true" /> Receipt
              lines
            </CardTitle>
            <CardDescription>
              Enter supplier cost in KES per sale unit. The server confirms the
              final total and stock movement together.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {!lines.length ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <PackagePlus
                  className="mx-auto size-8 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="mt-3 font-medium">No receipt lines yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add products from the catalogue panel.
                </p>
              </div>
            ) : (
              <form onSubmit={submitReceipt} className="space-y-4">
                <div className="space-y-3">
                  {lines.map((line) => {
                    const lineTotal = lineTotalMinor(line)
                    const step =
                      line.product.unit === "each" ||
                      line.product.unit === "pack"
                        ? "1"
                        : "0.001"
                    return (
                      <div
                        key={line.product.id}
                        className="rounded-lg border p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{line.product.name}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {line.product.sku} · {line.product.unit}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeLine(line.product.id)}
                          >
                            Remove
                          </Button>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          <div className="space-y-2">
                            <Label htmlFor={`quantity-${line.product.id}`}>
                              Quantity
                            </Label>
                            <Input
                              id={`quantity-${line.product.id}`}
                              inputMode="decimal"
                              value={
                                pending?.uncertain
                                  ? (pending.lines.find(
                                      (pendingLine) =>
                                        pendingLine.productId ===
                                        line.product.id
                                    )?.quantity ?? line.quantity)
                                  : line.quantity
                              }
                              onChange={(event) =>
                                updateLine(
                                  line.product.id,
                                  "quantity",
                                  event.target.value
                                )
                              }
                              placeholder={
                                line.product.unit === "each" ||
                                line.product.unit === "pack"
                                  ? "e.g. 12"
                                  : "e.g. 1.250"
                              }
                              step={step}
                              disabled={saving || Boolean(pending?.uncertain)}
                              required
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`cost-${line.product.id}`}>
                              Unit cost (KES)
                            </Label>
                            <Input
                              id={`cost-${line.product.id}`}
                              inputMode="decimal"
                              value={
                                pending?.uncertain
                                  ? Number(
                                      pending.lines.find(
                                        (pendingLine) =>
                                          pendingLine.productId ===
                                          line.product.id
                                      )?.unitCostMinor ?? ""
                                    ) / 100 || line.unitCost
                                  : line.unitCost
                              }
                              onChange={(event) =>
                                updateLine(
                                  line.product.id,
                                  "unitCost",
                                  event.target.value
                                )
                              }
                              placeholder="e.g. 160.00"
                              step="0.01"
                              disabled={saving || Boolean(pending?.uncertain)}
                              required
                            />
                          </div>
                          <div className="flex items-end justify-between gap-2 sm:block sm:text-right">
                            <p className="text-xs text-muted-foreground">
                              Line total
                            </p>
                            <p className="mt-1 font-semibold tabular-nums">
                              {lineTotal === null
                                ? "Check quantity/cost"
                                : totalText(lineTotal)}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="purchase-reason">Reason for receipt</Label>
                  <Input
                    id="purchase-reason"
                    value={pending?.uncertain ? pending.reason : reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="e.g. Delivery note 1042"
                    minLength={3}
                    maxLength={200}
                    disabled={saving || Boolean(pending?.uncertain)}
                    required
                  />
                </div>
                {total === null && (
                  <p className="text-sm text-amber-700">
                    One or more lines has an invalid quantity, cost, or
                    fractional minor-unit total. Correct it before posting.
                  </p>
                )}
                {pending?.uncertain && (
                  <p
                    role="alert"
                    className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
                  >
                    <TriangleAlert
                      className="mt-0.5 size-4 shrink-0 text-amber-600"
                      aria-hidden="true"
                    />
                    The receipt result could not be confirmed. Retry the same
                    receipt to check whether it was committed.
                  </p>
                )}
                {submitError && !saving && (
                  <p role="alert" className="text-sm">
                    {submitError}
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Receipt total
                    </p>
                    <p className="text-xl font-semibold tabular-nums">
                      {totalText(total)}
                    </p>
                  </div>
                  <Button
                    type="submit"
                    disabled={
                      saving ||
                      Boolean(pending && !pending.uncertain) ||
                      !selectedSupplierId ||
                      total === null
                    }
                  >
                    {saving
                      ? "Confirming…"
                      : pending?.uncertain
                        ? "Retry same receipt"
                        : "Post receipt"}
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
