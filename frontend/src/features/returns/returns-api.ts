import type { SaleUnit } from "@/features/catalogue/catalogue-api"

export type SaleSummary = {
  saleId: string
  totalMinor: number
  refundedMinor: number
  refundableMinor: number
  createdAt: string
}

export type ReturnSaleLine = {
  productId: string
  name: string
  sku: string
  unit: SaleUnit
  soldQuantityMinor: number
  returnedQuantityMinor: number
  availableQuantityMinor: number
  unitPriceMinor: number
}

export type ReturnSale = SaleSummary & { lines: ReturnSaleLine[] }

export type ReturnResult = {
  returnId: string
  saleId: string
  amountMinor: number
  refundId: string
}

export class ReturnsError extends Error {
  readonly status: number

  constructor(message: string, status: number, options?: ErrorOptions) {
    super(message, options)
    this.status = status
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid returns response")
  }
  return Object.fromEntries(Object.entries(value))
}

function date(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
}

function integer(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${name} in returns response`)
  }
  return value
}

function unit(value: unknown): value is SaleUnit {
  return value === "each" || value === "pack" || value === "kg" || value === "l"
}

function summary(value: unknown): SaleSummary {
  const row = object(value)
  if (
    typeof row.saleId !== "string" ||
    !date(row.createdAt) ||
    integer(row.totalMinor, "sale total") <
      integer(row.refundedMinor, "refunded total")
  ) {
    throw new Error("Invalid sale summary")
  }
  const totalMinor = integer(row.totalMinor, "sale total")
  const refundedMinor = integer(row.refundedMinor, "refunded total")
  return {
    saleId: row.saleId,
    totalMinor,
    refundedMinor,
    refundableMinor: integer(row.refundableMinor, "refundable total"),
    createdAt: row.createdAt,
  }
}

function parseSale(value: unknown): ReturnSale {
  const row = object(value)
  if (!Array.isArray(row.lines)) throw new Error("Invalid return sale lines")
  return {
    ...summary(row),
    lines: row.lines.map((value: unknown) => {
      const line = object(value)
      if (
        typeof line.productId !== "string" ||
        typeof line.name !== "string" ||
        typeof line.sku !== "string" ||
        !unit(line.unit) ||
        integer(line.soldQuantityMinor, "sold quantity") <
          integer(line.returnedQuantityMinor, "returned quantity") ||
        integer(line.returnedQuantityMinor, "returned quantity") >
          integer(line.soldQuantityMinor, "sold quantity")
      ) {
        throw new Error("Invalid return sale line")
      }
      return {
        productId: line.productId,
        name: line.name,
        sku: line.sku,
        unit: line.unit,
        soldQuantityMinor: integer(line.soldQuantityMinor, "sold quantity"),
        returnedQuantityMinor: integer(
          line.returnedQuantityMinor,
          "returned quantity"
        ),
        availableQuantityMinor: integer(
          line.availableQuantityMinor,
          "available quantity"
        ),
        unitPriceMinor: integer(line.unitPriceMinor, "unit price"),
      }
    }),
  }
}

export async function returnsRequest(
  path: string,
  body?: unknown
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`/api/returns${path}`, {
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
    if (response.status === 401)
      window.dispatchEvent(new Event("paygo-session-expired"))
    const result: unknown = await response.json()
    if (!response.ok) {
      const value = object(result)
      throw new ReturnsError(
        typeof value.message === "string"
          ? value.message
          : "The return could not be completed.",
        response.status
      )
    }
    return result
  } catch (error) {
    if (error instanceof ReturnsError) throw error
    throw new ReturnsError(
      "The request could not be confirmed. Check your connection and retry.",
      0,
      { cause: error }
    )
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function getSales(search = "", page = 0) {
  const value = object(
    await returnsRequest(
      `/sales?${new URLSearchParams({ search, page: String(page) })}`
    )
  )
  if (!Array.isArray(value.sales) || typeof value.hasMore !== "boolean")
    throw new Error("Invalid sales response")
  return { sales: value.sales.map(summary), hasMore: value.hasMore }
}

export async function getSale(saleId: string) {
  return parseSale(await returnsRequest(`/sales/${encodeURIComponent(saleId)}`))
}

export async function createReturn(body: {
  saleId: string
  reason: string
  requestId: string
  lines: Array<{ productId: string; quantityMinor: string }>
}) {
  const value = object(await returnsRequest("", body))
  return {
    returnId: typeof value.returnId === "string" ? value.returnId : "",
    saleId: typeof value.saleId === "string" ? value.saleId : "",
    amountMinor: integer(value.amountMinor, "refund amount"),
    refundId: typeof value.refundId === "string" ? value.refundId : "",
  } satisfies ReturnResult
}
