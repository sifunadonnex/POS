import type { SaleUnit } from "../catalogue/catalogue-api"

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

export type PaymentResult = {
  paymentId: string
  saleId: string
  kind: PaymentKind
  amountMinor: number
  totalMinor: number
}

export class SalesError extends Error {
  readonly status: number

  constructor(message: string, status: number, options?: ErrorOptions) {
    super(message, options)
    this.status = status
  }
}

async function salesRequest(path: string, body: unknown): Promise<unknown> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`/api/sales${path}`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
