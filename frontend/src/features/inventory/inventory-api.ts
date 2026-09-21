export type InventoryUnit = "each" | "pack" | "kg" | "l"

export type StockRow = {
  productId: string
  sku: string
  name: string
  unit: InventoryUnit
  quantityMinor: number
  active: boolean
}

export type StockMovement = {
  id: string
  kind: "opening" | "receive" | "adjustment" | "stocktake"
  deltaMinor: number
  quantityAfterMinor: number
  reason: string
  createdAt: string
  actorName: string
}

export type StockChange = {
  productId: string
  unit: InventoryUnit
  quantityMinor: number
  movementId: string
}

export type StockAction = "opening" | "receive" | "adjust"

export class InventoryError extends Error {
  readonly status: number

  constructor(message: string, status: number, options?: ErrorOptions) {
    super(message, options)
    this.status = status
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid inventory response")
  }
  return Object.fromEntries(Object.entries(value))
}

function isUnit(value: unknown): value is InventoryUnit {
  return value === "each" || value === "pack" || value === "kg" || value === "l"
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value)
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
}

function parseStock(value: unknown): StockRow {
  const row = object(value)
  if (
    typeof row.productId !== "string" ||
    typeof row.sku !== "string" ||
    typeof row.name !== "string" ||
    !isUnit(row.unit) ||
    !isSafeInteger(row.quantityMinor) ||
    typeof row.active !== "boolean"
  ) {
    throw new Error("Invalid stock row")
  }
  return {
    productId: row.productId,
    sku: row.sku,
    name: row.name,
    unit: row.unit,
    quantityMinor: row.quantityMinor,
    active: row.active,
  }
}

function parseChange(value: unknown): StockChange {
  const result = object(value)
  if (
    typeof result.productId !== "string" ||
    !isUnit(result.unit) ||
    !isSafeInteger(result.quantityMinor) ||
    typeof result.movementId !== "string"
  ) {
    throw new Error("Invalid stock change response")
  }
  return {
    productId: result.productId,
    unit: result.unit,
    quantityMinor: result.quantityMinor,
    movementId: result.movementId,
  }
}

function parseMovement(value: unknown): StockMovement {
  const row = object(value)
  if (
    typeof row.id !== "string" ||
    (row.kind !== "opening" &&
      row.kind !== "receive" &&
      row.kind !== "adjustment" &&
      row.kind !== "stocktake") ||
    !isSafeInteger(row.deltaMinor) ||
    !isSafeInteger(row.quantityAfterMinor) ||
    typeof row.reason !== "string" ||
    !isDate(row.createdAt) ||
    typeof row.actorName !== "string"
  ) {
    throw new Error("Invalid stock history entry")
  }
  return {
    id: row.id,
    kind: row.kind,
    deltaMinor: row.deltaMinor,
    quantityAfterMinor: row.quantityAfterMinor,
    reason: row.reason,
    createdAt: row.createdAt,
    actorName: row.actorName,
  }
}

export async function inventoryRequest(
  path: string,
  body?: unknown
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`/api/inventory/${path}`, {
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
      throw new InventoryError(
        typeof value.message === "string"
          ? value.message
          : "The request could not be completed.",
        response.status
      )
    }
    return result
  } catch (error) {
    if (error instanceof InventoryError) throw error
    throw new InventoryError(
      "The request could not be confirmed. Check your connection and retry.",
      0,
      { cause: error }
    )
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function getStock(search: string, page: number) {
  const value = object(
    await inventoryRequest(
      `stock?${new URLSearchParams({ search, page: String(page) })}`
    )
  )
  if (!Array.isArray(value.stock) || typeof value.hasMore !== "boolean") {
    throw new Error("Invalid stock response")
  }
  return { stock: value.stock.map(parseStock), hasMore: value.hasMore }
}

export async function getHistory(productId: string, page: number) {
  const value = object(
    await inventoryRequest(
      `stock/${encodeURIComponent(productId)}/history?page=${page}`
    )
  )
  if (!Array.isArray(value.history) || typeof value.hasMore !== "boolean") {
    throw new Error("Invalid stock history response")
  }
  return { history: value.history.map(parseMovement), hasMore: value.hasMore }
}

export async function changeStock(
  action: StockAction,
  body: {
    productId: string
    quantity: string
    reason: string
    requestId: string
  }
) {
  const value = object(await inventoryRequest(action, body))
  return parseChange(value)
}
