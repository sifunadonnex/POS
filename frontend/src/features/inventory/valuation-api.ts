import { businessHeaders, record, text } from "../business/business-api"
import type { SaleUnit } from "../catalogue/catalogue-api"

export type ValuationProduct = {
  productId: string
  name: string
  sku: string
  unit: SaleUnit
  quantityMinor: string
  valueMinor: string | null
  departmentLabel: string
}
export type ValuationDepartment = {
  departmentId: string | null
  label: string
  stockValueMinor: string
  unvaluedProducts: number
  netSalesMinor: string
  netCostMinor: string
  missingCostLines: number
  grossProfitMinor: string | null
}
export type Valuation = {
  products: ValuationProduct[]
  departments: ValuationDepartment[]
}
function money(value: unknown): string {
  const result = text(value)
  if (!/^-?\d+$/.test(result)) throw new Error("Invalid valuation amount")
  return result
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid valuation count")
  return value
}
function unit(value: unknown): SaleUnit {
  if (value !== "each" && value !== "pack" && value !== "kg" && value !== "l")
    throw new Error("Invalid stock unit")
  return value
}
async function request(path: string, payload?: unknown): Promise<unknown> {
  const response = await fetch(`/api/inventory/valuation${path}`, {
    method: payload === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...businessHeaders() },
    signal: AbortSignal.timeout(20_000),
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  })
  if (response.status === 401)
    window.dispatchEvent(new Event("paygo-session-expired"))
  const value: unknown = await response.json()
  if (!response.ok)
    throw new Error(
      typeof record(value).message === "string"
        ? text(record(value).message)
        : "Valuation unavailable. Retry the same request."
    )
  return value
}
export async function getValuation(day: string): Promise<Valuation> {
  const body = record(await request(`?day=${encodeURIComponent(day)}`))
  if (!Array.isArray(body.products) || !Array.isArray(body.departments))
    throw new Error("Invalid valuation response")
  return {
    products: body.products.map((value) => {
      const p = record(value)
      return {
        productId: text(p.productId),
        name: text(p.name),
        sku: text(p.sku),
        unit: unit(p.unit),
        quantityMinor: money(p.quantityMinor),
        valueMinor: p.valueMinor === null ? null : money(p.valueMinor),
        departmentLabel: text(p.departmentLabel),
      }
    }),
    departments: body.departments.map((value) => {
      const d = record(value)
      return {
        departmentId: d.departmentId === null ? null : text(d.departmentId),
        label: text(d.label),
        stockValueMinor: money(d.stockValueMinor),
        unvaluedProducts: count(d.unvaluedProducts),
        netSalesMinor: money(d.netSalesMinor),
        netCostMinor: money(d.netCostMinor),
        missingCostLines: count(d.missingCostLines),
        grossProfitMinor:
          d.grossProfitMinor === null ? null : money(d.grossProfitMinor),
      }
    }),
  }
}
export type OpeningValuation = {
  requestId: string
  productId: string
  expectedQuantityMinor: string
  totalValueMinor: string
  reason: string
}
export async function saveOpeningValuation(payload: OpeningValuation) {
  await request("/opening", payload)
}
