export type DailySummary = {
  day: string
  saleCount: number
  salesTotalMinor: number
  paymentCount: number
  cashMinor: number
  cardMinor: number
  mpesaMinor: number
  refundCount: number
  refundMinor: number
  closedShiftCount: number
  varianceMinor: number
  lowStockCount: number
}

function integer(value: unknown, allowNegative = false): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    (allowNegative || value >= 0)
  )
}

function parseSummary(value: unknown, day: string): DailySummary {
  if (!value || typeof value !== "object")
    throw new Error("Invalid report response")
  const row = value as Record<string, unknown>
  const fields = [
    "saleCount",
    "salesTotalMinor",
    "paymentCount",
    "cashMinor",
    "cardMinor",
    "mpesaMinor",
    "refundCount",
    "refundMinor",
    "closedShiftCount",
    "varianceMinor",
    "lowStockCount",
  ]
  if (
    row.day !== day ||
    fields.some((field) =>
      field === "varianceMinor"
        ? !integer(row[field], true)
        : !integer(row[field])
    )
  ) {
    throw new Error("Invalid report response")
  }
  return {
    day,
    saleCount: row.saleCount as number,
    salesTotalMinor: row.salesTotalMinor as number,
    paymentCount: row.paymentCount as number,
    cashMinor: row.cashMinor as number,
    cardMinor: row.cardMinor as number,
    mpesaMinor: row.mpesaMinor as number,
    refundCount: row.refundCount as number,
    refundMinor: row.refundMinor as number,
    closedShiftCount: row.closedShiftCount as number,
    varianceMinor: row.varianceMinor as number,
    lowStockCount: row.lowStockCount as number,
  }
}

export async function getDailySummary(
  day: string,
  signal?: AbortSignal
): Promise<DailySummary> {
  const response = await fetch(
    `/api/reports/summary/${encodeURIComponent(day)}`,
    {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    }
  )
  if (response.status === 401) {
    window.dispatchEvent(new Event("paygo-session-expired"))
    throw new Error("Your session expired. Sign in again to continue.")
  }
  const result: unknown = await response.json()
  if (!response.ok) {
    const message =
      result &&
      typeof result === "object" &&
      "message" in result &&
      typeof result.message === "string"
        ? result.message
        : "The daily summary could not be loaded. Please retry."
    throw new Error(message)
  }
  return parseSummary(result, day)
}
