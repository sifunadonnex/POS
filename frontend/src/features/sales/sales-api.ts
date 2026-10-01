import {
  parseProduct,
  type Product,
  type SaleUnit,
} from "../catalogue/catalogue-api"

export type RegisterLine = {
  productId: string
  unit: SaleUnit
  quantity: number
}

export type QuoteLine = RegisterLine & {
  priceMinor: number
  lineTotalMinor: number
}

export type BasketQuote = {
  subtotalMinor: number
  totalMinor: number
  lines: QuoteLine[]
}

export type SaleResult = {
  saleId: string
  totalMinor: number
  lines: QuoteLine[]
}

export type PaymentKind = "cash" | "card" | "mpesa"
export type PaymentStatus = "unpaid" | "partial" | "paid"

export type SaleLedgerItem = {
  saleId: string
  cashierId: string
  cashierName: string
  totalMinor: number
  paidMinor: number
  refundedMinor: number
  balanceMinor: number
  lineCount: number
  paymentKinds: PaymentKind[]
  paymentStatus: PaymentStatus
  createdAt: string
}

export type PaymentResult = {
  paymentId: string
  saleId: string
  kind: PaymentKind
  amountMinor: number
  totalMinor: number
}

export type CheckoutResult = SaleResult & {
  payment: PaymentResult & {
    shiftId: string
    tenderedMinor: number
    changeMinor: number
  }
}

export type SaleReceipt = {
  saleId: string
  totalMinor: number
  createdAt: string
  lines: Array<{
    productId: string
    name: string
    sku: string
    unit: SaleUnit
    quantity: number
    unitPriceMinor: number
    lineTotalMinor: number
  }>
  payments: Array<{
    paymentId: string
    kind: PaymentKind
    amountMinor: number
    tenderedMinor: number
    changeMinor: number
    paidAt: string
  }>
}

export type SaleDetail = SaleLedgerItem & {
  lines: SaleReceipt["lines"]
  payments: SaleReceipt["payments"]
}

export type HeldOrder = {
  id: string
  ownerId: string
  ownerName: string
  note: string
  status: "held" | "resumed" | "cancelled"
  revision: number
  createdAt: string
  updatedAt: string
  lines: Array<{ product: Product; quantity: number }>
}

export class SalesError extends Error {
  readonly status: number

  constructor(message: string, status: number, options?: ErrorOptions) {
    super(message, options)
    this.status = status
  }
}

async function salesRequest(
  path: string,
  body?: unknown,
  method: "GET" | "POST" = "POST"
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`/api/sales${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    })
    if (response.status === 401)
      window.dispatchEvent(new Event("paygo-session-expired"))
    const result: unknown = await response.json()
    if (!response.ok) {
      const value = object(result)
      throw new SalesError(
        typeof value.message === "string"
          ? value.message
          : "The sale could not be confirmed.",
        response.status
      )
    }
    return result
  } catch (error) {
    if (error instanceof SalesError) throw error
    throw new SalesError(
      "The request could not be confirmed. Check your connection and retry.",
      0,
      { cause: error }
    )
  } finally {
    window.clearTimeout(timeout)
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid sales response")
  return Object.fromEntries(Object.entries(value))
}

function saleUnit(value: unknown): value is SaleUnit {
  return value === "each" || value === "pack" || value === "kg" || value === "l"
}

function integer(value: unknown, name: string, minimum = 0): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  )
    throw new Error(`Invalid ${name} in sales response`)
  return value
}

function registerLine(value: unknown): QuoteLine {
  const row = object(value)
  if (
    typeof row.productId !== "string" ||
    !saleUnit(row.unit) ||
    typeof row.quantity !== "number" ||
    !Number.isFinite(row.quantity) ||
    row.quantity <= 0
  )
    throw new Error("Invalid basket line in sales response")
  return {
    productId: row.productId,
    unit: row.unit,
    quantity: row.quantity,
    priceMinor: integer(row.priceMinor, "price"),
    lineTotalMinor: integer(row.lineTotalMinor, "line total"),
  }
}

function quote(value: unknown): BasketQuote {
  const row = object(value)
  if (!Array.isArray(row.lines)) throw new Error("Invalid basket quote")
  return {
    subtotalMinor: integer(row.subtotalMinor, "subtotal"),
    totalMinor: integer(row.totalMinor, "total"),
    lines: row.lines.map(registerLine),
  }
}

function date(value: unknown, name: string) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Invalid ${name} in sales response`)
  }
  return value
}

function paymentKind(value: unknown): value is PaymentKind {
  return value === "cash" || value === "card" || value === "mpesa"
}

function paymentState(value: unknown): value is PaymentStatus {
  return value === "unpaid" || value === "partial" || value === "paid"
}

function saleLine(value: unknown): SaleReceipt["lines"][number] {
  const line = object(value)
  if (
    typeof line.productId !== "string" ||
    typeof line.name !== "string" ||
    typeof line.sku !== "string" ||
    !saleUnit(line.unit) ||
    typeof line.quantity !== "number" ||
    !Number.isFinite(line.quantity) ||
    line.quantity <= 0
  ) {
    throw new Error("Invalid receipt line")
  }
  return {
    productId: line.productId,
    name: line.name,
    sku: line.sku,
    unit: line.unit,
    quantity: line.quantity,
    unitPriceMinor: integer(line.unitPriceMinor, "receipt unit price"),
    lineTotalMinor: integer(line.lineTotalMinor, "receipt line total"),
  }
}

function salePayment(value: unknown): SaleReceipt["payments"][number] {
  const payment = object(value)
  if (typeof payment.paymentId !== "string" || !paymentKind(payment.kind)) {
    throw new Error("Invalid receipt payment")
  }
  return {
    paymentId: payment.paymentId,
    kind: payment.kind,
    amountMinor: integer(payment.amountMinor, "receipt payment"),
    tenderedMinor: integer(payment.tenderedMinor, "receipt tender"),
    changeMinor: integer(payment.changeMinor, "receipt change"),
    paidAt: date(payment.paidAt, "payment date"),
  }
}

function ledgerItem(value: unknown): SaleLedgerItem {
  const row = object(value)
  if (
    typeof row.saleId !== "string" ||
    typeof row.cashierId !== "string" ||
    typeof row.cashierName !== "string" ||
    !Array.isArray(row.paymentKinds) ||
    !row.paymentKinds.every(paymentKind) ||
    !paymentState(row.paymentStatus)
  ) {
    throw new Error("Invalid sales-history item")
  }
  const totalMinor = integer(row.totalMinor, "sale total")
  const paidMinor = integer(row.paidMinor, "paid total")
  const refundedMinor = integer(row.refundedMinor, "refunded total")
  const balanceMinor = integer(row.balanceMinor, "outstanding balance")
  if (
    paidMinor > totalMinor ||
    refundedMinor > totalMinor ||
    balanceMinor !== totalMinor - paidMinor
  ) {
    throw new Error("Invalid sales-history totals")
  }
  return {
    saleId: row.saleId,
    cashierId: row.cashierId,
    cashierName: row.cashierName,
    totalMinor,
    paidMinor,
    refundedMinor,
    balanceMinor,
    lineCount: integer(row.lineCount, "line count"),
    paymentKinds: row.paymentKinds,
    paymentStatus: row.paymentStatus,
    createdAt: date(row.createdAt, "sale date"),
  }
}

function receipt(value: unknown): SaleReceipt {
  const row = object(value)
  if (typeof row.saleId !== "string" || !Array.isArray(row.lines)) {
    throw new Error("Invalid receipt response")
  }
  if (!Array.isArray(row.payments)) throw new Error("Invalid receipt payments")
  return {
    saleId: row.saleId,
    totalMinor: integer(row.totalMinor, "receipt total"),
    createdAt: date(row.createdAt, "receipt date"),
    lines: row.lines.map(saleLine),
    payments: row.payments.map(salePayment),
  }
}

function saleDetail(value: unknown): SaleDetail {
  const row = object(value)
  if (!Array.isArray(row.lines) || !Array.isArray(row.payments)) {
    throw new Error("Invalid sale details")
  }
  return {
    ...ledgerItem(row),
    lines: row.lines.map(saleLine),
    payments: row.payments.map(salePayment),
  }
}

function heldOrder(value: unknown): HeldOrder {
  const row = object(value)
  if (
    typeof row.id !== "string" ||
    typeof row.ownerId !== "string" ||
    typeof row.ownerName !== "string" ||
    typeof row.note !== "string" ||
    (row.status !== "held" &&
      row.status !== "resumed" &&
      row.status !== "cancelled") ||
    !Array.isArray(row.lines)
  ) {
    throw new Error("Invalid held-order response")
  }
  return {
    id: row.id,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    note: row.note,
    status: row.status,
    revision: integer(row.revision, "held-order revision", 1),
    createdAt: date(row.createdAt, "held-order date"),
    updatedAt: date(row.updatedAt, "held-order update date"),
    lines: row.lines.map((value) => {
      const line = object(value)
      if (
        typeof line.quantity !== "number" ||
        !Number.isFinite(line.quantity) ||
        line.quantity <= 0
      ) {
        throw new Error("Invalid held-order quantity")
      }
      return { product: parseProduct(line.product), quantity: line.quantity }
    }),
  }
}

export async function quoteBasket(lines: RegisterLine[]): Promise<BasketQuote> {
  return quote(await salesRequest("/quote", { lines }))
}

export async function finalizeSale(
  lines: RegisterLine[],
  requestId: string
): Promise<SaleResult> {
  const row = object(
    await salesRequest("", {
      lines,
      requestId,
      reason: "Register sale",
    })
  )
  if (typeof row.saleId !== "string") throw new Error("Invalid sale response")
  if (!Array.isArray(row.lines)) throw new Error("Invalid sale lines")
  return {
    saleId: row.saleId,
    totalMinor: integer(row.totalMinor, "sale total"),
    lines: row.lines.map(registerLine),
  }
}

export async function checkoutCashSale(
  lines: RegisterLine[],
  cashTenderedMinor: number,
  requestId: string
): Promise<CheckoutResult> {
  const row = object(
    await salesRequest("/checkout", {
      lines,
      cashTenderedMinor,
      requestId,
      reason: "Cash register sale",
    })
  )
  if (typeof row.saleId !== "string" || !Array.isArray(row.lines))
    throw new Error("Invalid checkout response")
  const payment = object(row.payment)
  if (
    typeof payment.paymentId !== "string" ||
    payment.kind !== "cash" ||
    typeof payment.shiftId !== "string"
  ) {
    throw new Error("Invalid checkout payment")
  }
  return {
    saleId: row.saleId,
    totalMinor: integer(row.totalMinor, "checkout total"),
    lines: row.lines.map(registerLine),
    payment: {
      paymentId: payment.paymentId,
      saleId: row.saleId,
      kind: "cash",
      amountMinor: integer(payment.amountMinor, "checkout payment", 1),
      totalMinor: integer(row.totalMinor, "checkout total"),
      shiftId: payment.shiftId,
      tenderedMinor: integer(payment.tenderedMinor, "cash tender", 1),
      changeMinor: integer(payment.changeMinor, "cash change"),
    },
  }
}

export async function recordPayment(
  saleId: string,
  kind: PaymentKind,
  amountMinor: number,
  requestId: string
): Promise<PaymentResult> {
  const row = object(
    await salesRequest(`/${encodeURIComponent(saleId)}/payments`, {
      requestId,
      kind,
      amountMinor,
      reason: `${kind} register payment`,
    })
  )
  if (
    typeof row.paymentId !== "string" ||
    typeof row.saleId !== "string" ||
    (row.kind !== "cash" && row.kind !== "card" && row.kind !== "mpesa")
  )
    throw new Error("Invalid payment response")
  return {
    paymentId: row.paymentId,
    saleId: row.saleId,
    kind: row.kind,
    amountMinor: integer(row.amountMinor, "payment amount", 1),
    totalMinor: integer(row.totalMinor, "payment total"),
  }
}

export async function getReceipt(saleId: string): Promise<SaleReceipt> {
  return receipt(
    await salesRequest(
      `/${encodeURIComponent(saleId)}/receipt`,
      undefined,
      "GET"
    )
  )
}

export async function getSalesLedger(filters: {
  search?: string
  from: string
  to: string
  page?: number
}) {
  const value = object(
    await salesRequest(
      `?${new URLSearchParams({
        search: filters.search ?? "",
        from: filters.from,
        to: filters.to,
        page: String(filters.page ?? 0),
      })}`,
      undefined,
      "GET"
    )
  )
  if (!Array.isArray(value.sales) || typeof value.hasMore !== "boolean") {
    throw new Error("Invalid sales-history response")
  }
  return {
    sales: value.sales.map(ledgerItem),
    hasMore: value.hasMore,
  }
}

export async function getSaleDetail(saleId: string): Promise<SaleDetail> {
  return saleDetail(
    await salesRequest(`/${encodeURIComponent(saleId)}`, undefined, "GET")
  )
}

export async function getHeldOrders(): Promise<HeldOrder[]> {
  const value = object(await salesRequest("/held-orders", undefined, "GET"))
  if (!Array.isArray(value.orders)) {
    throw new Error("Invalid held-orders response")
  }
  return value.orders.map(heldOrder)
}

export async function createHeldOrder(
  lines: RegisterLine[],
  note: string,
  requestId: string
): Promise<HeldOrder> {
  return heldOrder(
    await salesRequest("/held-orders", { lines, note, requestId })
  )
}

export async function resumeHeldOrder(
  id: string,
  revision: number,
  requestId: string
): Promise<HeldOrder> {
  return heldOrder(
    await salesRequest(`/held-orders/${encodeURIComponent(id)}/resume`, {
      revision,
      requestId,
    })
  )
}

export async function cancelHeldOrder(
  id: string,
  revision: number,
  requestId: string
): Promise<HeldOrder> {
  return heldOrder(
    await salesRequest(`/held-orders/${encodeURIComponent(id)}/cancel`, {
      revision,
      requestId,
    })
  )
}
