import type { InventoryUnit } from "@/features/inventory/inventory-api"

export type StocktakeResult = {
  countId: string
  productId: string
  quantityMinor: number
  deltaMinor: number
  previousQuantityMinor: number
}

export class StocktakeError extends Error {
  readonly status: number

  constructor(message: string, status: number, options?: ErrorOptions) {
    super(message, options)
    this.status = status
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid stocktake response")
  }
  return Object.fromEntries(Object.entries(value))
}

function integer(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`Invalid ${name} in stocktake response`)
  }
  return value
}

function parseResult(value: unknown): StocktakeResult {
  const result = object(value)
  if (
    typeof result.countId !== "string" ||
    typeof result.productId !== "string"
  ) {
    throw new Error("Invalid stocktake result")
  }
  return {
    countId: result.countId,
    productId: result.productId,
    quantityMinor: integer(result.quantityMinor, "counted quantity"),
    deltaMinor: integer(result.deltaMinor, "stocktake delta"),
    previousQuantityMinor: integer(
      result.previousQuantityMinor,
      "previous quantity"
    ),
  }
}

export async function stocktakeRequest(body: unknown): Promise<unknown> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch("/api/stocktake", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (response.status === 401) {
      window.dispatchEvent(new Event("paygo-session-expired"))
    }
    const result: unknown = await response.json()
    if (!response.ok) {
      const value = object(result)
      throw new StocktakeError(
        typeof value.message === "string"
          ? value.message
          : "The stocktake could not be completed.",
        response.status
      )
    }
    return result
  } catch (error) {
    if (error instanceof StocktakeError) throw error
    throw new StocktakeError(
      "The request could not be confirmed. Check your connection and retry.",
      0,
      { cause: error }
    )
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function countStock(body: {
  productId: string
  quantity: string
  reason: string
  requestId: string
}) {
  return parseResult(await stocktakeRequest(body))
}

export function quantityStep(unit: InventoryUnit) {
  return unit === "each" || unit === "pack" ? "1" : "0.001"
}
