import type { Product } from "@/features/catalogue/catalogue-api"

export type Supplier = {
  id: string
  name: string
  createdAt: string
}

export type PurchaseResult = {
  receiptId: string
  supplierId: string
  totalMinor: number
  status: "received"
}

export type SupplierLedger = {
  supplier: Supplier
  from: string
  to: string
  entries: Array<{
    entryId: string
    kind: "receipt" | "return"
    receiptId: string
    amountMinor: number
    signedMinor: number
    reason: string
    createdAt: string
  }>
  hasMore: boolean
}

export class PurchaseError extends Error {
  readonly status: number

  constructor(message: string, status: number, options?: ErrorOptions) {
    super(message, options)
    this.status = status
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid purchase response")
  }
  return Object.fromEntries(Object.entries(value))
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
}

function parseSupplier(value: unknown): Supplier {
  const supplier = object(value)
  if (
    typeof supplier.id !== "string" ||
    typeof supplier.name !== "string" ||
    !isDate(supplier.createdAt)
  ) {
    throw new Error("Invalid supplier response")
  }
  return {
    id: supplier.id,
    name: supplier.name,
    createdAt: supplier.createdAt,
  }
}

function parsePurchaseResult(value: unknown): PurchaseResult {
  const result = object(value)
  if (
    typeof result.receiptId !== "string" ||
    typeof result.supplierId !== "string" ||
    typeof result.totalMinor !== "number" ||
    !Number.isSafeInteger(result.totalMinor) ||
    result.status !== "received"
  ) {
    throw new Error("Invalid purchase confirmation")
  }
  return {
    receiptId: result.receiptId,
    supplierId: result.supplierId,
    totalMinor: result.totalMinor,
    status: "received",
  }
}

function parseSupplierLedger(value: unknown): SupplierLedger {
  const result = object(value)
  if (
    !isDate(result.from) ||
    !isDate(result.to) ||
    !result.supplier ||
    typeof result.supplier !== "object" ||
    !Array.isArray(result.entries) ||
    typeof result.hasMore !== "boolean"
  ) {
    throw new Error("Invalid supplier ledger response")
  }
  const entries = result.entries.map((value) => {
    const entry = object(value)
    if (
      typeof entry.entryId !== "string" ||
      (entry.kind !== "receipt" && entry.kind !== "return") ||
      typeof entry.receiptId !== "string" ||
      typeof entry.amountMinor !== "number" ||
      !Number.isSafeInteger(entry.amountMinor) ||
      typeof entry.signedMinor !== "number" ||
      !Number.isSafeInteger(entry.signedMinor) ||
      typeof entry.reason !== "string" ||
      !isDate(entry.createdAt)
    ) {
      throw new Error("Invalid supplier ledger entry")
    }
    const kind: "receipt" | "return" =
      entry.kind === "receipt" ? "receipt" : "return"
    return {
      entryId: entry.entryId,
      kind,
      receiptId: entry.receiptId,
      amountMinor: entry.amountMinor,
      signedMinor: entry.signedMinor,
      reason: entry.reason,
      createdAt: entry.createdAt,
    }
  })
  return {
    supplier: parseSupplier(result.supplier),
    from: result.from,
    to: result.to,
    entries,
    hasMore: result.hasMore,
  }
}

export async function purchaseRequest(
  path: string,
  body?: unknown
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`/api/purchases/${path}`, {
      method: body === undefined ? "GET" : "POST",
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
    if (response.status === 401) {
      window.dispatchEvent(new Event("paygo-session-expired"))
    }
    const result: unknown = await response.json()
    if (!response.ok) {
      const value = object(result)
      throw new PurchaseError(
        typeof value.message === "string"
          ? value.message
          : "The request could not be completed.",
        response.status
      )
    }
    return result
  } catch (error) {
    if (error instanceof PurchaseError) throw error
    throw new PurchaseError(
      "The request could not be confirmed. Check your connection and retry.",
      0,
      { cause: error }
    )
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function getSuppliers(search = "", page = 0) {
  const value = object(
    await purchaseRequest(
      `suppliers?${new URLSearchParams({ search, page: String(page) })}`
    )
  )
  if (!Array.isArray(value.suppliers) || typeof value.hasMore !== "boolean") {
    throw new Error("Invalid suppliers response")
  }
  return {
    suppliers: value.suppliers.map(parseSupplier),
    hasMore: value.hasMore,
  }
}

export async function getSupplierLedger(
  supplierId: string,
  from: string,
  to: string,
  page = 0
) {
  return parseSupplierLedger(
    await purchaseRequest(
      `suppliers/${encodeURIComponent(supplierId)}/ledger?${new URLSearchParams(
        {
          from,
          to,
          page: String(page),
        }
      )}`
    )
  )
}

export async function createSupplier(body: {
  name: string
  reason: string
  requestId: string
}) {
  const value = object(await purchaseRequest("suppliers", body))
  return parseSupplier(value.supplier)
}

export async function receivePurchase(body: {
  supplierId: string
  reason: string
  requestId: string
  lines: Array<{
    productId: string
    quantity: string
    unitCostMinor: string
  }>
}) {
  return parsePurchaseResult(await purchaseRequest("receive", body))
}

export type { Product }
