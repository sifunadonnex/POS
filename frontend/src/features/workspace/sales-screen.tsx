import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import {
  AlertCircle,
  Barcode,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  LoaderCircle,
  Minus,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  ShoppingCart,
  Smartphone,
  Trash2,
  WalletCards,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Product, SaleUnit } from "../catalogue/catalogue-api"
import { getProductByBarcode, getProducts } from "../catalogue/catalogue-api"
import { displayPrice, errorMessage } from "../catalogue/catalogue-format"
import {
  finalizeSale,
  quoteBasket,
  recordPayment,
  type BasketQuote,
  type PaymentKind,
  type SaleResult,
} from "../sales/sales-api"
import {
  closeShift,
  getCurrentShift,
  openShift,
  type CurrentShift,
} from "../sales/shifts-api"

type BasketItem = {
  product: Product
  quantity: number
}

type PendingPayment = {
  sale: SaleResult
  kind: PaymentKind
  amountMinor: number
}

const paymentOptions: Array<{
  kind: PaymentKind
  label: string
  icon: typeof WalletCards
}> = [
  { kind: "cash", label: "Cash", icon: CircleDollarSign },
  { kind: "card", label: "Card", icon: CreditCard },
  { kind: "mpesa", label: "M-Pesa", icon: Smartphone },
]

function requestId() {
  return crypto.randomUUID()
}

function minorFromInput(value: string): number | null {
  if (!/^\d+(?:\.\d{0,2})?$/.test(value.trim())) return null
  const [whole, fraction = ""] = value.trim().split(".")
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null
}

function money(value: number) {
  return displayPrice(String(value))
}

function quantityLabel(value: number, unit: SaleUnit) {
  return unit === "each" || unit === "pack"
    ? String(value)
    : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
}

function increment(unit: SaleUnit) {
  return unit === "each" || unit === "pack" ? 1 : 0.001
}

export function SalesScreen() {
  const [shift, setShift] = useState<CurrentShift | null>(null)
  const [shiftLoading, setShiftLoading] = useState(true)
  const [shiftError, setShiftError] = useState("")
  const [openingCash, setOpeningCash] = useState("")
  const [closingCash, setClosingCash] = useState("")
  const [shiftAction, setShiftAction] = useState<"opening" | "closing" | null>(
    null
  )
  const [showCloseShift, setShowCloseShift] = useState(false)

  const [products, setProducts] = useState<Product[]>([])
  const [catalogueLoading, setCatalogueLoading] = useState(true)
  const [catalogueError, setCatalogueError] = useState("")
  const [search, setSearch] = useState("")
  const [basket, setBasket] = useState<BasketItem[]>([])
  const [quote, setQuote] = useState<BasketQuote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState("")
  const [paymentKind, setPaymentKind] = useState<PaymentKind>("cash")
  const [paymentAmount, setPaymentAmount] = useState("")
  const [checkoutError, setCheckoutError] = useState("")
  const [successMessage, setSuccessMessage] = useState("")
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(
    null
  )
  const quoteSequence = useRef(0)
  const saleRequest = useRef<string | null>(null)
  const paymentRequest = useRef<string | null>(null)

  useEffect(() => {
    let current = true
    void Promise.allSettled([
      getCurrentShift(),
      getProducts({
        search: "",
        status: "active",
        categoryId: "",
        page: 0,
      }),
    ]).then(([shiftResult, productsResult]) => {
      if (!current) return
      if (shiftResult.status === "fulfilled") {
        setShift(shiftResult.value)
        setShiftError("")
      } else {
        setShiftError(errorMessage(shiftResult.reason))
      }
      if (productsResult.status === "fulfilled") {
        setProducts(productsResult.value.products)
        setCatalogueError("")
      } else {
        setCatalogueError(errorMessage(productsResult.reason))
      }
      setShiftLoading(false)
      setCatalogueLoading(false)
    })
    return () => {
      current = false
    }
  }, [])

  const basketLines = useMemo(
    () =>
      basket.map(({ product, quantity }) => ({
        productId: product.id,
        unit: product.unit,
        quantity,
      })),
    [basket]
  )

  const totalMinor = pendingPayment?.sale.totalMinor ?? quote?.totalMinor ?? 0
  const typedPaymentMinor = minorFromInput(paymentAmount)
  const effectivePaymentKind = pendingPayment?.kind ?? paymentKind
  const paymentMinor = pendingPayment?.amountMinor ?? typedPaymentMinor
  const canComplete =
    Boolean(shift) &&
    basket.length > 0 &&
    Boolean(quote) &&
    !quoteLoading &&
    paymentMinor === totalMinor &&
    !checkoutBusy

  function updateBasket(next: BasketItem[]) {
    setBasket(next)
    setCheckoutError("")
    setSuccessMessage("")
    setPendingPayment(null)
    saleRequest.current = null
    paymentRequest.current = null
    const sequence = ++quoteSequence.current
    if (!next.length) {
      setQuote(null)
      setQuoteError("")
      setQuoteLoading(false)
      setPaymentAmount("")
      return
    }
    setQuoteLoading(true)
    setQuoteError("")
    void quoteBasket(
      next.map(({ product, quantity }) => ({
        productId: product.id,
        unit: product.unit,
        quantity,
      }))
    )
      .then((result) => {
        if (sequence !== quoteSequence.current) return
        setQuote(result)
        setPaymentAmount((result.totalMinor / 100).toFixed(2))
      })
      .catch((failure: unknown) => {
        if (sequence !== quoteSequence.current) return
        setQuote(null)
        setQuoteError(errorMessage(failure))
      })
      .finally(() => {
        if (sequence === quoteSequence.current) setQuoteLoading(false)
      })
  }

  function addProduct(product: Product) {
    const existing = basket.find((item) => item.product.id === product.id)
    if (existing) {
      updateBasket(
        basket.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + increment(product.unit) }
            : item
        )
      )
      return
    }
    updateBasket([...basket, { product, quantity: increment(product.unit) }])
  }

  function adjustQuantity(productId: string, delta: number) {
    const item = basket.find((candidate) => candidate.product.id === productId)
    if (!item) return
    const nextQuantity = item.quantity + delta
    if (nextQuantity <= 0) {
      updateBasket(
        basket.filter((candidate) => candidate.product.id !== productId)
      )
    } else {
      updateBasket(
        basket.map((candidate) =>
          candidate.product.id === productId
            ? { ...candidate, quantity: nextQuantity }
            : candidate
        )
      )
    }
  }

  async function loadProducts(term: string) {
    setCatalogueLoading(true)
    setCatalogueError("")
    try {
      if (term) {
        try {
          const product = await getProductByBarcode(term)
          setProducts([product])
          return
        } catch {
          // Search by name or SKU when the scanner value is not a barcode.
        }
      }
      const result = await getProducts({
        search: term,
        status: "active",
        categoryId: "",
        page: 0,
      })
      setProducts(result.products)
    } catch (failure: unknown) {
      setProducts([])
      setCatalogueError(errorMessage(failure))
    } finally {
      setCatalogueLoading(false)
    }
  }

  async function findProducts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await loadProducts(search.trim())
  }

  async function retryRegister() {
    setShiftLoading(true)
    setShiftError("")
    try {
      setShift(await getCurrentShift())
    } catch (failure: unknown) {
      setShiftError(errorMessage(failure))
    } finally {
      setShiftLoading(false)
    }
  }

  async function startShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amount = minorFromInput(openingCash)
    if (amount === null) {
      setShiftError("Enter opening cash as a valid KES amount.")
      return
    }
    setShiftAction("opening")
    setShiftError("")
    try {
      const result = await openShift(amount, requestId())
      setShift(result)
      setOpeningCash("")
    } catch (failure: unknown) {
      setShiftError(errorMessage(failure))
    } finally {
      setShiftAction(null)
    }
  }

  async function finishShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!shift) return
    const amount = minorFromInput(closingCash)
    if (amount === null) {
      setShiftError("Enter counted closing cash as a valid KES amount.")
      return
    }
    setShiftAction("closing")
    setShiftError("")
    try {
      await closeShift(shift.shiftId, amount, requestId())
      setShift(null)
      setShowCloseShift(false)
      setClosingCash("")
      updateBasket([])
      setSuccessMessage(
        "Shift closed. The register is ready for the next opening."
      )
    } catch (failure: unknown) {
      setShiftError(errorMessage(failure))
    } finally {
      setShiftAction(null)
    }
  }

  async function completeSale() {
    if (
      !quote ||
      !shift ||
      paymentMinor === null ||
      paymentMinor !== totalMinor
    )
      return
    setCheckoutBusy(true)
    setCheckoutError("")
    setSuccessMessage("")
    try {
      let sale = pendingPayment?.sale
      if (!sale) {
        sale = await finalizeSale(
          basketLines,
          saleRequest.current ?? (saleRequest.current = requestId())
        )
        setPendingPayment({
          sale,
          kind: effectivePaymentKind,
          amountMinor: paymentMinor,
        })
      }
      await recordPayment(
        sale.saleId,
        effectivePaymentKind,
        paymentMinor,
        paymentRequest.current ?? (paymentRequest.current = requestId())
      )
      updateBasket([])
      setSuccessMessage(
        `Sale confirmed. Sale reference ${sale.saleId.slice(0, 8)} is recorded.`
      )
    } catch (failure: unknown) {
      setCheckoutError(errorMessage(failure))
    } finally {
      setCheckoutBusy(false)
    }
  }

  return (
    <section className="space-y-5" aria-label="Sales register">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
              Sell / register
            </p>
            {shift ? (
              <Badge variant="secondary" className="gap-1.5 rounded-full">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Shift open
              </Badge>
            ) : (
              <Badge variant="outline" className="rounded-full">
                Shift required
              </Badge>
            )}
          </div>
          <h3 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Sales register
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Search or scan a product, build the basket, then confirm payment.
          </p>
        </div>
        {shift && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              Opening float {money(shift.openingCashMinor)}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCloseShift((value) => !value)}
            >
              {showCloseShift ? "Keep shift open" : "Close shift"}
            </Button>
          </div>
        )}
      </div>

      {successMessage && (
        <div
          className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200"
          role="status"
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{successMessage}</span>
        </div>
      )}
      {checkoutError && <ErrorNotice message={checkoutError} />}

      {shiftLoading ? (
        <LoadingNotice label="Checking register status…" />
      ) : shiftError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <span className="flex items-center gap-2 text-destructive">
            <AlertCircle className="size-4" aria-hidden="true" />
            {shiftError}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void retryRegister()}
          >
            <RefreshCw className="mr-2 size-4" aria-hidden="true" />
            Retry status
          </Button>
        </div>
      ) : !shift ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-semibold">
                Open the register to start selling
              </p>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Count the opening float first. This records the register shift
                before sales begin.
              </p>
            </div>
            <form
              className="flex w-full gap-2 sm:max-w-sm"
              onSubmit={startShift}
            >
              <div className="min-w-0 flex-1">
                <Label htmlFor="opening-cash" className="sr-only">
                  Opening cash
                </Label>
                <Input
                  id="opening-cash"
                  inputMode="decimal"
                  placeholder="Opening cash (KES)"
                  value={openingCash}
                  onChange={(event) => setOpeningCash(event.target.value)}
                  disabled={shiftAction !== null}
                />
              </div>
              <Button type="submit" disabled={shiftAction !== null}>
                {shiftAction === "opening" ? "Opening…" : "Open register"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : showCloseShift ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-semibold">Close this shift</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Count the drawer and confirm the closing cash with the server.
              </p>
            </div>
            <form
              className="flex w-full gap-2 sm:max-w-sm"
              onSubmit={finishShift}
            >
              <div className="min-w-0 flex-1">
                <Label htmlFor="closing-cash" className="sr-only">
                  Closing cash
                </Label>
                <Input
                  id="closing-cash"
                  inputMode="decimal"
                  placeholder="Closing cash (KES)"
                  value={closingCash}
                  onChange={(event) => setClosingCash(event.target.value)}
                  disabled={shiftAction !== null}
                />
              </div>
              <Button
                type="submit"
                variant="destructive"
                disabled={shiftAction !== null}
              >
                {shiftAction === "closing" ? "Closing…" : "Confirm close"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(21rem,0.42fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader className="border-b pb-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Search className="size-4" aria-hidden="true" />
                    Product lookup
                  </CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Search by name or SKU, or scan a barcode into the field.
                  </p>
                </div>
                <Badge variant="outline" className="w-fit gap-1.5">
                  <Barcode className="size-3.5" aria-hidden="true" />
                  Scanner ready
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              <form className="flex gap-2" onSubmit={findProducts}>
                <div className="relative min-w-0 flex-1">
                  <Search
                    className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Label htmlFor="register-product-search" className="sr-only">
                    Search products or scan barcode
                  </Label>
                  <Input
                    id="register-product-search"
                    placeholder="Search products or scan barcode"
                    className="h-10 pl-9"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    autoComplete="off"
                    autoFocus
                  />
                </div>
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={catalogueLoading}
                >
                  {catalogueLoading ? "Finding…" : "Find"}
                </Button>
              </form>

              {catalogueLoading ? (
                <LoadingNotice label="Loading active products…" />
              ) : catalogueError ? (
                <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
                  <p className="flex items-center gap-2 text-destructive">
                    <AlertCircle className="size-4" aria-hidden="true" />
                    {catalogueError}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadProducts(search.trim())}
                  >
                    Retry products
                  </Button>
                </div>
              ) : !products.length ? (
                <div className="rounded-lg border border-dashed p-6 text-center">
                  <p className="font-medium">No active products found</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Try a different name, SKU or barcode, or add products in
                    Catalogue.
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {products.map((product) => (
                    <button
                      type="button"
                      key={product.id}
                      className="group rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => addProduct(product)}
                      disabled={
                        !shift || checkoutBusy || Boolean(pendingPayment)
                      }
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{product.name}</p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {product.sku} · per {product.unit}
                          </p>
                        </div>
                        <Plus
                          className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                          aria-hidden="true"
                        />
                      </div>
                      <p className="mt-4 font-semibold tabular-nums">
                        {displayPrice(product.priceMinor)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
              {!shift && !shiftLoading && (
                <p className="text-xs text-muted-foreground">
                  Open a shift above before adding products to the basket.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Register guidance</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
              <Guidance
                icon={Barcode}
                title="Scan"
                text="Keep the cursor in lookup for scanner input."
              />
              <Guidance
                icon={ReceiptText}
                title="Review"
                text="Prices and totals are quoted by the server."
              />
              <Guidance
                icon={CheckCircle2}
                title="Confirm"
                text="Confirmation appears only after payment is recorded."
              />
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit overflow-hidden">
          <CardHeader className="border-b bg-muted/30 pb-4">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShoppingCart className="size-4" aria-hidden="true" />
                Current basket
              </CardTitle>
              <Badge variant="secondary" className="rounded-full">
                {basket.length} {basket.length === 1 ? "line" : "lines"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            {!basket.length ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <ShoppingCart
                  className="mx-auto size-7 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="mt-3 font-medium">Basket is empty</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Select a product to begin the next sale.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {basket.map(({ product, quantity }) => {
                  const quoted = quote?.lines.find(
                    (line) => line.productId === product.id
                  )
                  const lineTotal = quoted?.lineTotalMinor ?? 0
                  return (
                    <div key={product.id} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{product.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {money(
                              quoted?.priceMinor ?? Number(product.priceMinor)
                            )}{" "}
                            / {product.unit}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0"
                          aria-label={`Remove ${product.name}`}
                          disabled={checkoutBusy || Boolean(pendingPayment)}
                          onClick={() => adjustQuantity(product.id, -quantity)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="icon"
                            className="size-8"
                            aria-label={`Decrease ${product.name}`}
                            disabled={checkoutBusy || Boolean(pendingPayment)}
                            onClick={() =>
                              adjustQuantity(
                                product.id,
                                -increment(product.unit)
                              )
                            }
                          >
                            <Minus className="size-3.5" aria-hidden="true" />
                          </Button>
                          <span className="min-w-12 text-center text-sm font-medium tabular-nums">
                            {quantityLabel(quantity, product.unit)}
                          </span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="size-8"
                            aria-label={`Increase ${product.name}`}
                            disabled={checkoutBusy || Boolean(pendingPayment)}
                            onClick={() =>
                              adjustQuantity(
                                product.id,
                                increment(product.unit)
                              )
                            }
                          >
                            <Plus className="size-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                        <p className="font-semibold tabular-nums">
                          {quote ? money(lineTotal) : "—"}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {quoteError && <ErrorNotice message={quoteError} />}
            <div className="space-y-2 border-t pt-4 text-sm">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="font-medium text-foreground tabular-nums">
                  {quoteLoading ? "Quoting…" : money(quote?.subtotalMinor ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between text-base font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{money(totalMinor)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Payment method</Label>
              <div className="grid grid-cols-3 gap-2">
                {paymentOptions.map(({ kind, label, icon: Icon }) => (
                  <Button
                    type="button"
                    key={kind}
                    variant={paymentKind === kind ? "secondary" : "outline"}
                    className="h-auto flex-col gap-1 py-2 text-xs"
                    aria-pressed={paymentKind === kind}
                    disabled={
                      checkoutBusy || !basket.length || Boolean(pendingPayment)
                    }
                    onClick={() => setPaymentKind(kind)}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="payment-amount">Amount received (KES)</Label>
              <Input
                id="payment-amount"
                inputMode="decimal"
                value={paymentAmount}
                onChange={(event) => setPaymentAmount(event.target.value)}
                disabled={
                  checkoutBusy || !basket.length || Boolean(pendingPayment)
                }
                aria-describedby="payment-help"
              />
              <p id="payment-help" className="text-xs text-muted-foreground">
                Enter the exact total. Split payments are not enabled in this
                register yet.
              </p>
            </div>

            <Button
              className="w-full gap-2"
              size="lg"
              disabled={!canComplete}
              onClick={() => void completeSale()}
            >
              {checkoutBusy ? (
                <LoaderCircle
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <CheckCircle2 className="size-4" aria-hidden="true" />
              )}
              {checkoutBusy ? "Confirming…" : "Complete sale"}
            </Button>
            {pendingPayment && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Sale created but payment is not confirmed. Retry the same
                payment to finish it.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

function LoadingNotice({ label }: { label: string }) {
  return (
    <p
      className="flex items-center gap-2 rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground"
      role="status"
    >
      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      {label}
    </p>
  )
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <p
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
      role="alert"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {message}
    </p>
  )
}

function Guidance({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof Barcode
  title: string
  text: string
}) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-2 font-medium text-foreground">
        <Icon className="size-4" aria-hidden="true" />
        {title}
      </p>
      <p>{text}</p>
    </div>
  )
}
