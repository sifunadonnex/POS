export type SaleUnit = "each" | "pack" | "kg" | "l"
export type Category = { id: string; name: string; revision: number }
export type Product = {
  id: string
  sku: string
  name: string
  categoryId: string | null
  categoryName: string | null
  unit: SaleUnit
  priceMinor: string
  taxCode: string | null
  active: boolean
  revision: number
  barcodes: string[]
}
export type HistoryEntry = {
  id: string
  revision: number
  reason: string
  createdAt: string
  actorName: string
  snapshot: Product
}
export type ImportPreview = {
  canImport: boolean
  rows: {
    row: number
    sku: string
    name: string
    categoryName: string
    unit: SaleUnit | null
    priceMinor: string | null
    errors: string[]
  }[]
}
export class CatalogueError extends Error {
  readonly status: number
  constructor(message: string, status: number, options?: ErrorOptions) {
    super(message, options)
    this.status = status
  }
}

export async function catalogueRequest(
  path: string,
  body?: unknown,
  method = "POST"
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`/api/catalogue/${path}`, {
      method: body === undefined ? "GET" : method,
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
      throw new CatalogueError(
        typeof value.message === "string"
          ? value.message
          : "The request could not be completed.",
        response.status
      )
    }
    return result
  } catch (error) {
    if (error instanceof CatalogueError) throw error
    throw new CatalogueError(
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
    throw new Error("Invalid catalogue response")
  return Object.fromEntries(Object.entries(value))
}
function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((v: unknown) => typeof v === "string")
  )
}
export function isUnit(value: unknown): value is SaleUnit {
  return value === "each" || value === "pack" || value === "kg" || value === "l"
}
function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}
function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}
function isPrice(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d{0,8})$/.test(value)
}
export function parseCategory(value: unknown): Category {
  const v = object(value)
  if (
    typeof v.id !== "string" ||
    typeof v.name !== "string" ||
    !isRevision(v.revision)
  )
    throw new Error("Invalid category response")
  return { id: v.id, name: v.name, revision: v.revision }
}
export function parseProduct(value: unknown): Product {
  const v = object(value)
  if (
    typeof v.id !== "string" ||
    typeof v.sku !== "string" ||
    typeof v.name !== "string" ||
    !nullableText(v.categoryId) ||
    !nullableText(v.categoryName) ||
    !isUnit(v.unit) ||
    !isPrice(v.priceMinor) ||
    !nullableText(v.taxCode) ||
    typeof v.active !== "boolean" ||
    !isRevision(v.revision) ||
    !strings(v.barcodes)
  )
    throw new Error("Invalid product response")
  return {
    id: v.id,
    sku: v.sku,
    name: v.name,
    categoryId: v.categoryId,
    categoryName: v.categoryName,
    unit: v.unit,
    priceMinor: v.priceMinor,
    taxCode: v.taxCode,
    active: v.active,
    revision: v.revision,
    barcodes: v.barcodes,
  }
}
export function savedProduct(value: unknown) {
  return parseProduct(object(value).product)
}
export function savedCategory(value: unknown) {
  return parseCategory(object(value).category)
}
export async function getCategories() {
  const v = object(await catalogueRequest("categories"))
  if (!Array.isArray(v.categories))
    throw new Error("Invalid categories response")
  return v.categories.map(parseCategory)
}
export async function getProducts(query: {
  search: string
  status: string
  categoryId: string
  page: number
}) {
  const v = object(
    await catalogueRequest(
      `products?${new URLSearchParams({ ...query, page: String(query.page) })}`
    )
  )
  if (!Array.isArray(v.products) || typeof v.hasMore !== "boolean")
    throw new Error("Invalid products response")
  return { products: v.products.map(parseProduct), hasMore: v.hasMore }
}
export async function getProductByBarcode(code: string): Promise<Product> {
  const v = object(
    await catalogueRequest(
      `products/by-barcode?code=${encodeURIComponent(code)}`
    )
  )
  return parseProduct(v.product)
}
export async function getHistory(id: string, page: number) {
  const v = object(
    await catalogueRequest(
      `products/${encodeURIComponent(id)}/history?page=${page}`
    )
  )
  if (!Array.isArray(v.history) || typeof v.hasMore !== "boolean")
    throw new Error("Invalid history response")
  const history: HistoryEntry[] = v.history.map((value: unknown) => {
    const h = object(value)
    if (
      typeof h.id !== "string" ||
      !isRevision(h.revision) ||
      typeof h.reason !== "string" ||
      typeof h.createdAt !== "string" ||
      !Number.isFinite(Date.parse(h.createdAt)) ||
      typeof h.actorName !== "string"
    )
      throw new Error("Invalid history entry")
    return {
      id: h.id,
      revision: h.revision,
      reason: h.reason,
      createdAt: h.createdAt,
      actorName: h.actorName,
      snapshot: parseProduct(h.snapshot),
    }
  })
  return { history, hasMore: v.hasMore }
}
export async function previewImport(csv: string): Promise<ImportPreview> {
  const v = object(await catalogueRequest("imports/preview", { csv }))
  if (typeof v.canImport !== "boolean" || !Array.isArray(v.rows))
    throw new Error("Invalid import preview")
  const rows = v.rows.map((value: unknown) => {
    const row = object(value)
    if (
      !isRevision(row.row) ||
      typeof row.sku !== "string" ||
      typeof row.name !== "string" ||
      typeof row.categoryName !== "string" ||
      !(row.unit === null || isUnit(row.unit)) ||
      !(row.priceMinor === null || isPrice(row.priceMinor)) ||
      !strings(row.errors)
    )
      throw new Error("Invalid import row")
    return {
      row: row.row,
      sku: row.sku,
      name: row.name,
      categoryName: row.categoryName,
      unit: row.unit,
      priceMinor: row.priceMinor,
      errors: row.errors,
    }
  })
  return { rows, canImport: v.canImport }
}
export function importedCount(value: unknown): number {
  const v = object(value)
  if (
    !isRevision(v.imported) ||
    !strings(v.productIds) ||
    v.productIds.length !== v.imported
  )
    throw new Error("Import could not be confirmed")
  return v.imported
}
