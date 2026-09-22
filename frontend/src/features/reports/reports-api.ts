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

export type PurchaseReconciliation = {
  from: string
  to: string
  summary: {
    receiptCount: number
    receivedTotalMinor: number
    returnCount: number
    returnedTotalMinor: number
    netPurchasesMinor: number
    supplierCount: number
  }
  suppliers: Array<{
    supplierId: string
    supplierName: string
    receiptCount: number
    receivedTotalMinor: number
    returnCount: number
    returnedTotalMinor: number
    netPurchasesMinor: number
    lastReceiptAt: string | null
  }>
  receipts: Array<{
    receiptId: string
    supplierId: string
    supplierName: string
    totalMinor: number
    returnedTotalMinor: number
    netTotalMinor: number
    reason: string
    createdAt: string
    lineCount: number
  }>
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
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

function parsePurchaseReconciliation(value: unknown): PurchaseReconciliation {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid purchase reconciliation response")
  }
  const row = value as Record<string, unknown>
  if (typeof row.from !== "string" || typeof row.to !== "string") {
    throw new Error("Invalid purchase reconciliation response")
  }
  const summaryValue = row.summary
  if (!summaryValue || typeof summaryValue !== "object") {
    throw new Error("Invalid purchase reconciliation response")
  }
  const summary = summaryValue as Record<string, unknown>
  const summaryFields = [
    "receiptCount",
    "receivedTotalMinor",
    "returnCount",
    "returnedTotalMinor",
    "netPurchasesMinor",
    "supplierCount",
  ]
  if (
    summaryFields.some((field) =>
      field === "netPurchasesMinor"
        ? !integer(summary[field], true)
        : !integer(summary[field])
    ) ||
    !Array.isArray(row.suppliers) ||
    !Array.isArray(row.receipts)
  ) {
    throw new Error("Invalid purchase reconciliation response")
  }

  const suppliers = row.suppliers.map((value) => {
    if (!value || typeof value !== "object") {
      throw new Error("Invalid purchase reconciliation supplier")
    }
    const supplier = value as Record<string, unknown>
    const fields = [
      "receiptCount",
      "receivedTotalMinor",
      "returnCount",
      "returnedTotalMinor",
      "netPurchasesMinor",
    ]
    if (
      typeof supplier.supplierId !== "string" ||
      typeof supplier.supplierName !== "string" ||
      (supplier.lastReceiptAt !== null && !isDate(supplier.lastReceiptAt)) ||
      fields.some((field) =>
        field === "netPurchasesMinor"
          ? !integer(supplier[field], true)
          : !integer(supplier[field])
      )
    ) {
      throw new Error("Invalid purchase reconciliation supplier")
    }
    return {
      supplierId: supplier.supplierId,
      supplierName: supplier.supplierName,
      receiptCount: supplier.receiptCount as number,
      receivedTotalMinor: supplier.receivedTotalMinor as number,
      returnCount: supplier.returnCount as number,
      returnedTotalMinor: supplier.returnedTotalMinor as number,
      netPurchasesMinor: supplier.netPurchasesMinor as number,
      lastReceiptAt: supplier.lastReceiptAt as string | null,
    }
  })

  const receipts = row.receipts.map((value) => {
    if (!value || typeof value !== "object") {
      throw new Error("Invalid purchase reconciliation receipt")
    }
    const receipt = value as Record<string, unknown>
    const fields = [
      "totalMinor",
      "returnedTotalMinor",
      "netTotalMinor",
      "lineCount",
    ]
    if (
      typeof receipt.receiptId !== "string" ||
      typeof receipt.supplierId !== "string" ||
      typeof receipt.supplierName !== "string" ||
      typeof receipt.reason !== "string" ||
      !isDate(receipt.createdAt) ||
      fields.some((field) =>
        field === "netTotalMinor"
          ? !integer(receipt[field], true)
          : !integer(receipt[field])
      )
    ) {
      throw new Error("Invalid purchase reconciliation receipt")
    }
    return {
      receiptId: receipt.receiptId,
      supplierId: receipt.supplierId,
      supplierName: receipt.supplierName,
      totalMinor: receipt.totalMinor as number,
      returnedTotalMinor: receipt.returnedTotalMinor as number,
      netTotalMinor: receipt.netTotalMinor as number,
      reason: receipt.reason,
      createdAt: receipt.createdAt as string,
      lineCount: receipt.lineCount as number,
    }
  })

  return {
    from: row.from,
    to: row.to,
    summary: {
      receiptCount: summary.receiptCount as number,
      receivedTotalMinor: summary.receivedTotalMinor as number,
      returnCount: summary.returnCount as number,
      returnedTotalMinor: summary.returnedTotalMinor as number,
      netPurchasesMinor: summary.netPurchasesMinor as number,
      supplierCount: summary.supplierCount as number,
    },
    suppliers,
    receipts,
  }
}

export async function getPurchaseReconciliation(
  from: string,
  to: string,
  signal?: AbortSignal
): Promise<PurchaseReconciliation> {
  const response = await fetch(
    `/api/reports/purchases?${new URLSearchParams({ from, to })}`,
    { credentials: "same-origin", cache: "no-store", signal }
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
        : "The purchase reconciliation could not be loaded. Please retry."
    throw new Error(message)
  }
  return parsePurchaseReconciliation(result)
}
