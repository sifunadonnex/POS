import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import {
  AlertCircle,
  Barcode,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  LoaderCircle,
  Minus,
  PauseCircle,
  Plus,
  Printer,
  Play,
  ReceiptText,
  RefreshCw,
  Search,
  ShoppingCart,
  Smartphone,
  Trash2,
  WalletCards,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatNairobiDateTime } from "@/lib/format"
import type { Product, SaleUnit } from "../catalogue/catalogue-api"
import { getProductByBarcode, getProducts } from "../catalogue/catalogue-api"
import { displayPrice, errorMessage } from "../catalogue/catalogue-format"
import {
  cancelHeldOrder,
  getRegisterBasket,
  saveRegisterBasket,
  type CartApproval,
  checkoutCashSale,
  createHeldOrder,
  finalizeSale,
  getHeldOrders,
  getReceipt,
  quoteBasket,
  resumeHeldOrder,
  type BasketQuote,
  type HeldOrder,
  type PaymentKind,
  type SaleReceipt,
} from "../sales/sales-api"
import { SaleReceiptView } from "../sales/sale-receipt"
import {
  getPaymentCapabilities,
  reconcilePaymentAttempt,
  startPaymentAttempt,
  type ExternalPaymentKind,
  type PaymentAttempt,
  type PaymentAttemptStatus,
  type PaymentCapabilities,
} from "../sales/payment-attempts-api"
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

const paymentOptions: Array<{
  kind: PaymentKind
  label: string
  icon: typeof WalletCards
}> = [
  { kind: "cash", label: "Cash", icon: CircleDollarSign },
  { kind: "card", label: "Card", icon: CreditCard },
  { kind: "mpesa", label: "M-Pesa", icon: Smartphone },
]

type ExternalPaymentFlow = {
  saleId: string
  kind: ExternalPaymentKind
  requestId: string
  attempt: Pick<PaymentAttempt, "attemptId" | "status"> | null
}

const EXTERNAL_PAYMENT_KEY = "paygo-external-payment"

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null
}

function isPaymentAttemptStatus(value: unknown): value is PaymentAttemptStatus {
  return value === "pending" || value === "unknown" || value === "failed"
}

function readExternalPayment(): ExternalPaymentFlow | null {
  if (typeof window === "undefined") return null
  try {
    const value = record(
      JSON.parse(window.localStorage.getItem(EXTERNAL_PAYMENT_KEY) ?? "null")
    )
    if (
      !value ||
      typeof value.saleId !== "string" ||
      typeof value.requestId !== "string" ||
      (value.kind !== "card" && value.kind !== "mpesa")
    ) {
      return null
    }
    const flow: Omit<ExternalPaymentFlow, "attempt"> = {
      saleId: value.saleId,
      requestId: value.requestId,
      kind: value.kind,
    }
    if (value.attempt === null) return { ...flow, attempt: null }
    const savedAttempt = record(value.attempt)
    if (!savedAttempt || typeof savedAttempt.attemptId !== "string") return null
    const status = savedAttempt.status
    if (!isPaymentAttemptStatus(status)) return null
    return {
      ...flow,
      attempt: { attemptId: savedAttempt.attemptId, status },
    }
  } catch {
    return null
  }
}

function requestId() {
  return crypto.randomUUID()
}

function minorFromInput(value: string): number | null {
  if (!/^\d+(?:\.\d{0,2})?$/.test(value.trim())) return null
  const [whole, fraction = ""] = value.trim().split(".")
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null
}

function validMpesaPhone(value: string) {
  const compact = value.trim().replace(/[\s()-]/g, "")
  const normalized = compact.startsWith("+254")
    ? compact.slice(1)
    : compact.startsWith("0")
      ? `254${compact.slice(1)}`
      : compact
  return /^254(?:7|1)\d{8}$/.test(normalized)
}

function money(value: number) {
  return displayPrice(String(value))
}

function variance(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : ""
  return `${sign}${money(Math.abs(value))}`
}

function quantityLabel(value: number, unit: SaleUnit) {
  return unit === "each" || unit === "pack"
    ? String(value)
    : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
}

function increment(unit: SaleUnit) {
  return unit === "each" || unit === "pack" ? 1 : 0.001
}

export function SalesScreen({
  staffRole = "cashier",
  onSelectWorkspace,
}: {
  staffRole?: "manager" | "supervisor" | "cashier"
  onSelectWorkspace?: () => void
}) {
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
  const [heldOrders, setHeldOrders] = useState<HeldOrder[]>([])
  const [heldOrdersLoading, setHeldOrdersLoading] = useState(true)
  const [heldOrdersError, setHeldOrdersError] = useState("")
  const [heldAction, setHeldAction] = useState<string | null>(null)
  const [holdNote, setHoldNote] = useState("")
  const [quote, setQuote] = useState<BasketQuote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(true)
  const [quoteError, setQuoteError] = useState("")
  const [externalPayment, setExternalPayment] =
    useState<ExternalPaymentFlow | null>(readExternalPayment)
  const [paymentKind, setPaymentKind] = useState<PaymentKind>(
    externalPayment?.kind ?? "cash"
  )
  const [paymentCapabilities, setPaymentCapabilities] =
    useState<PaymentCapabilities>({ card: false, mpesa: false })
  const [paymentCapabilitiesError, setPaymentCapabilitiesError] = useState("")
  const [paymentAmount, setPaymentAmount] = useState("")
  const [mpesaPhone, setMpesaPhone] = useState("")
  const [checkoutError, setCheckoutError] = useState("")
  const [successMessage, setSuccessMessage] = useState("")
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null)
  const [receiptSearch, setReceiptSearch] = useState("")
  const [receiptLoading, setReceiptLoading] = useState(false)
  const [receiptError, setReceiptError] = useState("")
  const basketRevision = useRef(0)
  const basketSaveBusy = useRef(false)
  const [basketReady, setBasketReady] = useState(false)
  const [approvalAction, setApprovalAction] = useState<
    { lines: BasketItem[] } | { order: HeldOrder } | null
  >(null)
  const [approvalPending, setApprovalPending] = useState(false)
  const [approvalError, setApprovalError] = useState("")
  const checkoutRequest = useRef<string | null>(null)
  const holdRequest = useRef<string | null>(null)
  const heldTransitionRequests = useRef(new Map<string, string>())

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
      getPaymentCapabilities(),
      getHeldOrders(),
    ]).then(
      ([shiftResult, productsResult, capabilitiesResult, heldOrdersResult]) => {
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
        if (capabilitiesResult.status === "fulfilled") {
          setPaymentCapabilities(capabilitiesResult.value)
          setPaymentCapabilitiesError("")
        } else {
          setPaymentCapabilities({ card: false, mpesa: false })
          setPaymentCapabilitiesError(errorMessage(capabilitiesResult.reason))
        }
        if (heldOrdersResult.status === "fulfilled") {
          setHeldOrders(heldOrdersResult.value)
          setHeldOrdersError("")
        } else {
          setHeldOrdersError(errorMessage(heldOrdersResult.reason))
        }
        setShiftLoading(false)
        setCatalogueLoading(false)
        setHeldOrdersLoading(false)
      }
    )
    return () => {
      current = false
    }
  }, [])

  useEffect(() => {
    try {
      if (externalPayment) {
        window.localStorage.setItem(
          EXTERNAL_PAYMENT_KEY,
          JSON.stringify(externalPayment)
        )
      } else {
        window.localStorage.removeItem(EXTERNAL_PAYMENT_KEY)
      }
    } catch {
      // The server remains authoritative if browser storage is unavailable.
    }
  }, [externalPayment])

  const basketLines = useMemo(
    () =>
      basket.map(({ product, quantity }) => ({
        productId: product.id,
        unit: product.unit,
        quantity,
      })),
    [basket]
  )

  const totalMinor = quote?.totalMinor ?? 0
  const cashTenderedMinor = minorFromInput(paymentAmount)
  const changeMinor =
    cashTenderedMinor !== null && cashTenderedMinor >= totalMinor
      ? cashTenderedMinor - totalMinor
      : null
  const selectedPaymentAvailable =
    paymentKind === "cash" || paymentCapabilities[paymentKind]
  const basketLocked =
    checkoutBusy ||
    Boolean(externalPayment) ||
    quoteLoading ||
    !basketReady ||
    approvalPending
  const stockProblem = basket.find(({ product }) => !canAdd(product, 0))
  const canComplete =
    Boolean(shift) &&
    !checkoutBusy &&
    (Boolean(externalPayment) ||
      (basket.length > 0 &&
        !stockProblem &&
        Boolean(quote) &&
        !quoteLoading &&
        selectedPaymentAvailable &&
        (paymentKind !== "mpesa" ||
          (totalMinor % 100 === 0 && validMpesaPhone(mpesaPhone))) &&
        (paymentKind !== "cash" ||
          (cashTenderedMinor !== null && cashTenderedMinor >= totalMinor))))

  function applyBasket(next: BasketItem[], result: BasketQuote | null) {
    setBasket(next)
    setQuote(result)
    setQuoteError("")
    setPaymentAmount(result ? (result.totalMinor / 100).toFixed(2) : "")
    setCheckoutError("")
    checkoutRequest.current = null
    holdRequest.current = null
  }
  async function restoreBasket() {
    setQuoteLoading(true)
    try {
      const saved = await getRegisterBasket()
      basketRevision.current = saved.revision
      applyBasket(saved.lines, null)
      setBasketReady(true)
      if (saved.lines.length) {
        try {
          const result = await quoteBasket(
            saved.lines.map(({ product, quantity }) => ({
              productId: product.id,
              unit: product.unit,
              quantity,
            }))
          )
          setQuote(result)
          setPaymentAmount((result.totalMinor / 100).toFixed(2))
        } catch (failure) {
          setQuoteError(errorMessage(failure))
        }
      }
    } catch (failure) {
      setQuoteError(errorMessage(failure))
      setBasketReady(false)
    } finally {
      setQuoteLoading(false)
    }
  }
  useEffect(() => {
    let current = true
    void getRegisterBasket()
      .then(async (saved) => {
        if (!current) return
        basketRevision.current = saved.revision
        setBasket(saved.lines)
        setBasketReady(true)
        if (!saved.lines.length) return
        try {
          const result = await quoteBasket(
            saved.lines.map(({ product, quantity }) => ({
              productId: product.id,
              unit: product.unit,
              quantity,
            }))
          )
          if (current) {
            setQuote(result)
            setPaymentAmount((result.totalMinor / 100).toFixed(2))
          }
        } catch (failure) {
          if (current) setQuoteError(errorMessage(failure))
        }
      })
      .catch((failure: unknown) => {
        if (current) {
          setQuoteError(errorMessage(failure))
          setBasketReady(false)
        }
      })
      .finally(() => {
        if (current) setQuoteLoading(false)
      })
    return () => {
      current = false
    }
  }, [])
  async function persistBasket(next: BasketItem[], approval?: CartApproval) {
    if (basketSaveBusy.current) return false
    basketSaveBusy.current = true
    setQuoteLoading(true)
    setQuoteError("")
    try {
      const result = await saveRegisterBasket(
        next.map(({ product, quantity }) => ({
          productId: product.id,
          unit: product.unit,
          quantity,
        })),
        basketRevision.current,
        approval
      )
      basketRevision.current = result.revision
      applyBasket(next, next.length ? result.quote : null)
      setExternalPayment(null)
      setMpesaPhone("")
      return true
    } catch (failure) {
      const message = errorMessage(failure)
      setQuoteError(message)
      setApprovalError(message)
      return false
    } finally {
      basketSaveBusy.current = false
      setQuoteLoading(false)
    }
  }
  function updateBasket(next: BasketItem[]) {
    if (basketLocked || basketSaveBusy.current) return
    const reduction = basket.some(
      (item) =>
        !next.some(
          (candidate) =>
            candidate.product.id === item.product.id &&
            candidate.quantity >= item.quantity
        )
    )
    if (reduction && staffRole === "cashier") {
      setApprovalError("")
      setApprovalAction({ lines: next })
      return
    }
    void persistBasket(next)
  }

  function canAdd(product: Product, quantity = increment(product.unit)) {
    const currentProduct =
      products.find((candidate) => candidate.id === product.id) ?? product
    if (currentProduct.availableQuantityMinor === undefined) return false
    const inBasket =
      basket.find((item) => item.product.id === product.id)?.quantity ?? 0
    const scale = product.unit === "each" || product.unit === "pack" ? 1 : 1000
    return (
      BigInt(Math.round(inBasket * scale)) +
        BigInt(Math.round(quantity * scale)) <=
      BigInt(currentProduct.availableQuantityMinor)
    )
  }

  function addProduct(product: Product) {
    if (!canAdd(product)) return
    const existing = basket.find((item) => item.product.id === product.id)
    if (existing) {
      updateBasket(
        basket.map((item) =>
          item.product.id === product.id
            ? {
                ...item,
                quantity:
                  Math.round((item.quantity + increment(product.unit)) * 1000) /
                  1000,
              }
            : item
        )
      )
      return
    }
    updateBasket([...basket, { product, quantity: increment(product.unit) }])
  }

  function adjustQuantity(productId: string, delta: number) {
    const item = basket.find((candidate) => candidate.product.id === productId)
    if (!item || (delta > 0 && !canAdd(item.product, delta))) return
    const nextQuantity = Math.round((item.quantity + delta) * 1000) / 1000
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

  async function holdBasket() {
    if (!basket.length || basketLocked || heldAction) return
    const operationId = holdRequest.current ?? requestId()
    holdRequest.current = operationId
    setHeldAction("create")
    setCheckoutError("")
    try {
      const held = await createHeldOrder(basketLines, holdNote, operationId)
      setHeldOrders((current) => [held, ...current])
      void restoreBasket()
      setHoldNote("")
      setSuccessMessage(
        "Order held on the server. Resume it from any authorized register."
      )
    } catch (failure: unknown) {
      setCheckoutError(errorMessage(failure))
    } finally {
      setHeldAction(null)
    }
  }

  async function resumeBasket(order: HeldOrder) {
    if (basket.length || basketLocked || heldAction) return
    const transitionKey = `resume:${order.id}`
    const operationId =
      heldTransitionRequests.current.get(transitionKey) ?? requestId()
    heldTransitionRequests.current.set(transitionKey, operationId)
    setHeldAction(order.id)
    setHeldOrdersError("")
    try {
      await resumeHeldOrder(order.id, order.revision, operationId)
      heldTransitionRequests.current.delete(transitionKey)
      setHeldOrders((current) =>
        current.filter((candidate) => candidate.id !== order.id)
      )
      void restoreBasket()
      setSuccessMessage("Held order resumed and re-quoted by the server.")
    } catch (failure: unknown) {
      setHeldOrdersError(errorMessage(failure))
    } finally {
      setHeldAction(null)
    }
  }

  async function cancelBasket(order: HeldOrder, approval?: CartApproval) {
    if (staffRole === "cashier" && !approval) {
      setApprovalError("")
      setApprovalAction({ order })
      return
    }
    if (basketLocked || heldAction) return
    const transitionKey = `cancel:${order.id}`
    const operationId =
      heldTransitionRequests.current.get(transitionKey) ?? requestId()
    heldTransitionRequests.current.set(transitionKey, operationId)
    setHeldAction(order.id)
    setHeldOrdersError("")
    try {
      await cancelHeldOrder(order.id, order.revision, operationId, approval)
      heldTransitionRequests.current.delete(transitionKey)
      setHeldOrders((current) =>
        current.filter((candidate) => candidate.id !== order.id)
      )
      setSuccessMessage("Held order cancelled. Its history remains recorded.")
    } catch (failure: unknown) {
      setHeldOrdersError(errorMessage(failure))
      if (approval) throw failure
    } finally {
      setHeldAction(null)
    }
  }

  async function reloadHeldOrders() {
    setHeldOrdersLoading(true)
    setHeldOrdersError("")
    try {
      setHeldOrders(await getHeldOrders())
    } catch (failure: unknown) {
      setHeldOrdersError(errorMessage(failure))
    } finally {
      setHeldOrdersLoading(false)
    }
  }

  async function loadReceipt(saleId: string) {
    const value = saleId.trim()
    if (!value) {
      setReceiptError("Enter a sale reference to find a receipt.")
      return
    }
    setReceiptLoading(true)
    setReceiptError("")
    try {
      const result = await getReceipt(value)
      setReceipt(result)
      setReceiptSearch(result.saleId)
    } catch (failure: unknown) {
      setReceipt(null)
      setReceiptError(errorMessage(failure))
    } finally {
      setReceiptLoading(false)
    }
  }

  function printReceipt() {
    if (receipt) window.print()
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
    if (!shift || basketLocked) return
    const amount = minorFromInput(closingCash)
    if (amount === null) {
      setShiftError("Enter counted closing cash as a valid KES amount.")
      return
    }
    setShiftAction("closing")
    setShiftError("")
    try {
      const result = await closeShift(shift.shiftId, amount, requestId())
      setShift(null)
      setShowCloseShift(false)
      setClosingCash("")
      void restoreBasket()
      setSuccessMessage(
        `Shift closed. Expected cash ${money(result.expectedCashMinor)}; variance ${variance(result.varianceMinor)}.`
      )
    } catch (failure: unknown) {
      setShiftError(errorMessage(failure))
    } finally {
      setShiftAction(null)
    }
  }

  async function completeSale() {
    if (!shift || !canComplete) return
    if (!externalPayment && (!quote || !selectedPaymentAvailable)) return
    if (
      paymentKind === "cash" &&
      (cashTenderedMinor === null || cashTenderedMinor < totalMinor)
    ) {
      return
    }
    setCheckoutBusy(true)
    setCheckoutError("")
    setSuccessMessage("")
    try {
      if (paymentKind === "cash") {
        if (cashTenderedMinor === null) return
        const result = await checkoutCashSale(
          basketLines,
          cashTenderedMinor,
          checkoutRequest.current ?? (checkoutRequest.current = requestId())
        )
        void restoreBasket()
        setSuccessMessage(
          result.payment.changeMinor > 0
            ? `Sale confirmed. Change due ${money(result.payment.changeMinor)}. Sale reference ${result.saleId.slice(0, 8)} is recorded.`
            : `Sale confirmed. Sale reference ${result.saleId.slice(0, 8)} is recorded.`
        )
        void loadReceipt(result.saleId)
        return
      }

      let flow = externalPayment
      if (!flow) {
        const sale = await finalizeSale(
          basketLines,
          checkoutRequest.current ?? (checkoutRequest.current = requestId())
        )
        flow = {
          saleId: sale.saleId,
          kind: paymentKind,
          requestId: requestId(),
          attempt: null,
        }
        setExternalPayment(flow)
      }

      if (
        flow.attempt?.status === "pending" ||
        flow.attempt?.status === "unknown"
      ) {
        const attempt = await reconcilePaymentAttempt(flow.attempt.attemptId)
        await applyExternalPayment(flow, attempt)
        return
      }

      if (flow.attempt?.status === "failed") {
        flow = { ...flow, requestId: requestId(), attempt: null }
        setExternalPayment(flow)
      }
      const attempt = await startPaymentAttempt(
        flow.saleId,
        flow.kind,
        flow.requestId,
        flow.kind === "mpesa" ? mpesaPhone : undefined
      )
      await applyExternalPayment(flow, attempt)
    } catch (failure: unknown) {
      setCheckoutError(errorMessage(failure))
    } finally {
      setCheckoutBusy(false)
      void loadProducts(search.trim())
    }
  }

  async function applyExternalPayment(
    flow: ExternalPaymentFlow,
    attempt: PaymentAttempt
  ) {
    setExternalPayment({ ...flow, attempt })
    if (attempt.status !== "confirmed") return

    setExternalPayment(null)
    window.localStorage.removeItem(EXTERNAL_PAYMENT_KEY)
    void restoreBasket()
    void loadProducts(search.trim())
    const label = attempt.kind === "mpesa" ? "M-Pesa" : "Card"
    setSuccessMessage(
      `${label} payment confirmed. Sale reference ${attempt.saleId.slice(0, 8)} is recorded.`
    )
    await loadReceipt(attempt.saleId)
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
              disabled={basketLocked}
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
      <Dialog
        open={approvalAction !== null}
        onOpenChange={(open) => {
          if (!open && !approvalPending) setApprovalAction(null)
        }}
      >
        <DialogContent showCloseButton={!approvalPending}>
          <DialogTitle>Supervisor approval</DialogTitle>
          <DialogDescription>
            A supervisor or manager must approve reducing quantities, removing
            products or cancelling a held order. Adding customer items does not
            need approval.
          </DialogDescription>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (approvalPending || !approvalAction) return
              const form = event.currentTarget,
                data = new FormData(form)
              const approval = {
                email: String(data.get("email") ?? ""),
                password: String(data.get("password") ?? ""),
                reason: String(data.get("reason") ?? ""),
              }
              setApprovalPending(true)
              setApprovalError("")
              void (
                "lines" in approvalAction
                  ? persistBasket(approvalAction.lines, approval)
                  : cancelBasket(approvalAction.order, approval).then(
                      () => true
                    )
              )
                .then((saved) => {
                  if (saved) setApprovalAction(null)
                })
                .catch((failure: unknown) =>
                  setApprovalError(errorMessage(failure))
                )
                .finally(() => {
                  form.reset()
                  setApprovalPending(false)
                })
            }}
          >
            <fieldset disabled={approvalPending} className="space-y-3">
              <Label htmlFor="approval-email">Supervisor email</Label>
              <Input
                id="approval-email"
                name="email"
                type="email"
                autoComplete="off"
                required
              />
              <Label htmlFor="approval-password">Supervisor password</Label>
              <Input
                id="approval-password"
                name="password"
                type="password"
                autoComplete="off"
                required
                maxLength={128}
              />
              <Label htmlFor="approval-reason">Reason for change</Label>
              <Input
                id="approval-reason"
                name="reason"
                required
                minLength={3}
                maxLength={200}
              />
              <Button type="submit">
                {approvalPending ? "Verifying…" : "Approve this change"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setApprovalAction(null)}
              >
                Cancel
              </Button>
            </fieldset>
            {approvalError && (
              <p role="alert" className="text-sm text-destructive">
                {approvalError}
              </p>
            )}
          </form>
        </DialogContent>
      </Dialog>
      {checkoutError && <ErrorNotice message={checkoutError} />}
      {!basketReady && !quoteLoading && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <p className="font-semibold">Register unavailable</p>
          <p className="mt-1">
            {quoteError || "The saved basket could not be loaded."}
          </p>
          <p className="mt-1 text-muted-foreground">
            Products stay disabled until the register is ready, even when stock
            is available.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {onSelectWorkspace && (
              <Button variant="outline" size="sm" onClick={onSelectWorkspace}>
                Choose department & till
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void restoreBasket()}
            >
              Reload saved basket
            </Button>
          </div>
        </div>
      )}

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
                  disabled={shiftAction !== null || basketLocked}
                />
              </div>
              <Button
                type="submit"
                variant="destructive"
                disabled={shiftAction !== null || basketLocked}
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
                      disabled={!shift || basketLocked || !canAdd(product)}
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
                      <p className="mt-3 text-xs text-muted-foreground">
                        {product.availableQuantityMinor === undefined
                          ? "Stock unavailable; refresh products"
                          : BigInt(product.availableQuantityMinor) <= 0n
                            ? "Out of stock"
                            : !canAdd(product)
                              ? "All available stock in basket"
                              : `${quantityLabel(Number(product.availableQuantityMinor) / (product.unit === "each" || product.unit === "pack" ? 1 : 1000), product.unit)} ${product.unit} in stock`}
                      </p>
                      {!basketReady && !quoteLoading && (
                        <p className="mt-1 text-xs text-destructive">
                          Register unavailable; see the message above.
                        </p>
                      )}
                      <p className="mt-2 font-semibold tabular-nums">
                        {displayPrice(product.priceMinor)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={catalogueLoading}
                onClick={() => void loadProducts(search.trim())}
              >
                <RefreshCw className="size-4" aria-hidden="true" /> Refresh
                stock
              </Button>
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

          <Card>
            <CardHeader className="border-b pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <PauseCircle className="size-4" aria-hidden="true" />
                Held orders
                <Badge variant="secondary" className="ml-auto rounded-full">
                  {heldOrders.length}
                </Badge>
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Saved on the server. Cashiers see their own; managers can review
                the whole shop.
              </p>
            </CardHeader>
            <CardContent className="space-y-2 p-4">
              {heldOrdersLoading ? (
                <LoadingNotice label="Loading held orders…" />
              ) : heldOrdersError ? (
                <div className="space-y-3">
                  <ErrorNotice message={heldOrdersError} />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void reloadHeldOrders()}
                  >
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                    Retry
                  </Button>
                </div>
              ) : heldOrders.length === 0 ? (
                <div className="rounded-lg border border-dashed p-5 text-center">
                  <p className="font-medium">No held orders</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Hold the current basket when a customer needs more time.
                  </p>
                </div>
              ) : (
                heldOrders.map((held) => (
                  <div key={held.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">
                          Order {held.id.slice(0, 8)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {held.lines.length}{" "}
                          {held.lines.length === 1 ? "line" : "lines"} ·{" "}
                          {held.ownerName} ·{" "}
                          {formatNairobiDateTime(held.createdAt)}
                        </p>
                        {held.note && (
                          <p className="mt-2 text-sm">{held.note}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          onClick={() => void resumeBasket(held)}
                          disabled={
                            Boolean(basket.length) ||
                            basketLocked ||
                            Boolean(heldAction)
                          }
                        >
                          {heldAction === held.id ? (
                            <LoaderCircle
                              className="size-3.5 animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <Play className="size-3.5" aria-hidden="true" />
                          )}
                          Resume
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`Cancel held order ${held.id.slice(0, 8)}`}
                          onClick={() => void cancelBasket(held)}
                          disabled={basketLocked || Boolean(heldAction)}
                        >
                          <X className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="print:border-0 print:shadow-none">
            <CardHeader className="border-b pb-3 print:hidden">
              <CardTitle className="flex items-center gap-2 text-base">
                <ReceiptText className="size-4" aria-hidden="true" />
                Receipt / reprint
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Print the latest paid sale or find a completed sale by
                reference.
              </p>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              <form
                className="flex gap-2 print:hidden"
                onSubmit={(event) => {
                  event.preventDefault()
                  void loadReceipt(receiptSearch)
                }}
              >
                <Input
                  aria-label="Sale reference"
                  placeholder="Paste sale reference"
                  value={receiptSearch}
                  onChange={(event) => setReceiptSearch(event.target.value)}
                />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={receiptLoading}
                >
                  {receiptLoading ? "Finding…" : "Find"}
                </Button>
              </form>
              {receiptError && <ErrorNotice message={receiptError} />}
              {receiptLoading && <LoadingNotice label="Loading receipt…" />}
              {receipt && !receiptLoading && (
                <div aria-label="Receipt" className="space-y-4">
                  <div className="flex items-center justify-between gap-3 print:hidden">
                    <div>
                      <p className="font-semibold">Receipt ready</p>
                      <p className="text-xs text-muted-foreground">
                        Formatted for 80 mm paper
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5 print:hidden"
                      onClick={printReceipt}
                    >
                      <Printer className="size-3.5" aria-hidden="true" />
                      Print
                    </Button>
                  </div>
                  <div className="overflow-hidden rounded-xl bg-muted/40 p-3 sm:p-5 print:contents">
                    <SaleReceiptView receipt={receipt} />
                  </div>
                </div>
              )}
              {!receipt && !receiptError && !receiptLoading && (
                <p className="text-sm text-muted-foreground print:hidden">
                  A receipt will appear here after a payment is confirmed.
                </p>
              )}
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
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="rounded-full">
                  {basket.length} {basket.length === 1 ? "line" : "lines"}
                </Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void holdBasket()}
                  disabled={
                    !basket.length || basketLocked || Boolean(heldAction)
                  }
                >
                  {heldAction === "create" ? (
                    <LoaderCircle
                      className="size-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <PauseCircle className="size-3.5" aria-hidden="true" />
                  )}
                  {heldAction === "create" ? "Holding…" : "Hold"}
                </Button>
              </div>
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
                          disabled={basketLocked}
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
                            disabled={basketLocked}
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
                            disabled={basketLocked || !canAdd(product)}
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

            {basket.length > 0 && (
              <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                <Label htmlFor="hold-note">Hold note (optional)</Label>
                <Input
                  id="hold-note"
                  value={holdNote}
                  onChange={(event) => setHoldNote(event.target.value)}
                  maxLength={160}
                  placeholder="Customer name or pickup detail"
                  disabled={basketLocked || Boolean(heldAction)}
                />
                <p className="text-xs text-muted-foreground">
                  Keep notes brief and avoid unnecessary personal information.
                </p>
              </div>
            )}

            {quoteError && basketReady && (
              <>
                <ErrorNotice message={quoteError} />
                <Button
                  variant="outline"
                  disabled={quoteLoading}
                  onClick={() => void restoreBasket()}
                >
                  Reload saved basket
                </Button>
              </>
            )}
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
                {paymentOptions.map(({ kind, label, icon: Icon }) => {
                  const available = kind === "cash" || paymentCapabilities[kind]
                  return (
                    <Button
                      type="button"
                      key={kind}
                      variant={paymentKind === kind ? "secondary" : "outline"}
                      className="h-auto flex-col gap-1 py-2 text-xs"
                      aria-pressed={paymentKind === kind}
                      disabled={basketLocked || !basket.length || !available}
                      onClick={() => setPaymentKind(kind)}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                      {label}
                    </Button>
                  )
                })}
              </div>
            </div>

            {paymentKind === "cash" ? (
              <div className="space-y-2">
                <Label htmlFor="payment-amount">Cash received (KES)</Label>
                <Input
                  id="payment-amount"
                  inputMode="decimal"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                  disabled={basketLocked || !basket.length}
                  aria-describedby="payment-help"
                />
                <p id="payment-help" className="text-xs text-muted-foreground">
                  Enter the cash handed over. Change is calculated before the
                  sale is confirmed; split payments are not enabled yet.
                </p>
                {cashTenderedMinor !== null &&
                  cashTenderedMinor < totalMinor && (
                    <p className="text-xs text-destructive">
                      Cash received is {money(totalMinor - cashTenderedMinor)}{" "}
                      short.
                    </p>
                  )}
                {changeMinor !== null && (
                  <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Change due</span>
                    <span className="font-semibold tabular-nums">
                      {money(changeMinor)}
                    </span>
                  </div>
                )}
              </div>
            ) : externalPayment ? (
              <ExternalPaymentNotice flow={externalPayment} />
            ) : paymentKind === "mpesa" ? (
              <div className="space-y-2">
                <Label htmlFor="mpesa-phone">Customer M-Pesa phone</Label>
                <Input
                  id="mpesa-phone"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="0712 345 678"
                  value={mpesaPhone}
                  onChange={(event) => setMpesaPhone(event.target.value)}
                  disabled={basketLocked || !basket.length}
                  aria-describedby="mpesa-help"
                />
                <p id="mpesa-help" className="text-xs text-muted-foreground">
                  The customer receives an STK prompt. The sale is paid only
                  after Daraja confirms the exact amount.
                </p>
                {mpesaPhone && !validMpesaPhone(mpesaPhone) && (
                  <p className="text-xs text-destructive">
                    Enter a Kenyan mobile number such as 0712345678.
                  </p>
                )}
                {totalMinor % 100 !== 0 && (
                  <p className="text-xs text-destructive">
                    M-Pesa STK Push requires a whole-KES total. Use cash for
                    this basket.
                  </p>
                )}
              </div>
            ) : (
              <p className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
                The sale is finalized before the provider request starts. Only a
                verified provider confirmation records the payment and opens the
                receipt.
              </p>
            )}

            {(paymentCapabilitiesError ||
              (!paymentCapabilities.card && !paymentCapabilities.mpesa)) && (
              <p className="text-xs text-muted-foreground">
                {paymentCapabilitiesError
                  ? "Card and M-Pesa availability could not be verified. Cash remains available."
                  : "Card and M-Pesa are disabled until a payment provider is configured and verified."}
              </p>
            )}

            {stockProblem && !externalPayment && (
              <p
                role="status"
                className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                Check stock for {stockProblem.product.name}. Refresh stock, then
                reduce the basket quantity if needed.
              </p>
            )}
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
              {checkoutBusy
                ? externalPayment?.attempt?.status === "pending" ||
                  externalPayment?.attempt?.status === "unknown"
                  ? "Checking payment…"
                  : paymentKind === "cash"
                    ? "Confirming…"
                    : "Starting payment…"
                : externalPayment?.attempt?.status === "pending" ||
                    externalPayment?.attempt?.status === "unknown"
                  ? "Check payment status"
                  : externalPayment?.attempt?.status === "failed"
                    ? "Retry payment"
                    : externalPayment
                      ? "Retry payment request"
                      : "Complete sale"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

function ExternalPaymentNotice({ flow }: { flow: ExternalPaymentFlow }) {
  const reference = flow.attempt?.attemptId.slice(0, 8)
  const status = flow.attempt?.status
  const message =
    status === "pending"
      ? "The provider still reports this payment as pending. Do not collect another payment; check this attempt again."
      : status === "unknown"
        ? "The payment result is unknown. Do not collect another payment; reconcile this attempt before continuing."
        : status === "failed"
          ? "The provider reported that this payment failed and no payment was recorded. You can retry the payment for the same sale."
          : "The sale is finalized, but starting the provider request was not confirmed. Retry the same request; do not create another sale."

  return (
    <div
      className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100"
      role="status"
    >
      <p className="font-medium">
        {status ? `Payment ${status}` : "Payment request unconfirmed"}
        {reference ? ` · ${reference}` : ""}
      </p>
      <p>{message}</p>
    </div>
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
