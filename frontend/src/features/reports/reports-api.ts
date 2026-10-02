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
  lowStockItems: Array<{
    productId: string
    sku: string
    name: string
    unit: "each" | "pack" | "kg" | "l"
    quantityMinor: number
    thresholdMinor: number
  }>
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

export type SalesInsights = {
  from: string
  to: string
  days: number
  scope: SalesSourceOption
  availableSources: SalesSourceOption[]
  reportingLag: {
    status: "current" | "lagging" | "not_configured"
    pendingEvents: number
    receivedEvents: number
    projectedEvents: number
    latestReceivedAt: string | null
  }
  coverage: {
    synchronizedReturns: "not_applicable" | "not_available"
  }
  summary: {
    saleCount: number
    grossSalesMinor: number
    refundCount: number
    refundMinor: number
    netSalesMinor: number
    averageBasketMinor: number
    activeCashierCount: number
  }
  daily: Array<{
    day: string
    saleCount: number
    grossSalesMinor: number
    refundMinor: number
    netSalesMinor: number
  }>
  cashiers: Array<{
    cashierId: string
    cashierName: string
    source: "operational" | "edge"
    storeId: string | null
    saleCount: number
    grossSalesMinor: number
    refundMinor: number
    netSalesMinor: number
    averageBasketMinor: number
  }>
  paymentMix: Array<{
    kind: "cash" | "card" | "mpesa"
    paymentCount: number
    amountMinor: number
  }>
  topProducts: Array<{
    productId: string
    productName: string
    source: "operational" | "edge"
    storeId: string | null
    unit: "each" | "pack" | "kg" | "l"
    quantityMinor: number
    grossSalesMinor: number
    saleCount: number
  }>
}

export type SalesSourceOption = {
  source: "operational" | "edge" | "all"
  storeId: string | null
  label: string
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
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
    !Array.isArray(row.lowStockItems) ||
    fields.some((field) =>
      field === "varianceMinor"
        ? !integer(row[field], true)
        : !integer(row[field])
    )
  ) {
    throw new Error("Invalid report response")
  }
  const lowStockItems = row.lowStockItems.map((value) => {
    if (!value || typeof value !== "object") {
      throw new Error("Invalid low-stock alert")
    }
    const item = value as Record<string, unknown>
    if (
      typeof item.productId !== "string" ||
      typeof item.sku !== "string" ||
      typeof item.name !== "string" ||
      !["each", "pack", "kg", "l"].includes(String(item.unit)) ||
      !integer(item.quantityMinor) ||
      !integer(item.thresholdMinor) ||
      item.quantityMinor > item.thresholdMinor
    ) {
      throw new Error("Invalid low-stock alert")
    }
    return {
      productId: item.productId,
      sku: item.sku,
      name: item.name,
      unit: item.unit as "each" | "pack" | "kg" | "l",
      quantityMinor: item.quantityMinor,
      thresholdMinor: item.thresholdMinor,
    }
  })
  const lowStockCount = row.lowStockCount as number
  if (lowStockItems.length > lowStockCount) {
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
    lowStockCount,
    lowStockItems,
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

function parseSalesInsights(value: unknown): SalesInsights {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid sales insights response")
  }
  const row = value as Record<string, unknown>
  if (
    !isDay(row.from) ||
    !isDay(row.to) ||
    !integer(row.days) ||
    !row.scope ||
    typeof row.scope !== "object" ||
    !Array.isArray(row.availableSources) ||
    !row.reportingLag ||
    typeof row.reportingLag !== "object" ||
    !row.coverage ||
    typeof row.coverage !== "object" ||
    !row.summary ||
    typeof row.summary !== "object" ||
    !Array.isArray(row.daily) ||
    !Array.isArray(row.cashiers) ||
    !Array.isArray(row.paymentMix) ||
    !Array.isArray(row.topProducts)
  ) {
    throw new Error("Invalid sales insights response")
  }
  const parseSource = (value: unknown): SalesSourceOption => {
    if (!value || typeof value !== "object") {
      throw new Error("Invalid sales insights source")
    }
    const source = value as Record<string, unknown>
    if (
      !["operational", "edge", "all"].includes(String(source.source)) ||
      typeof source.label !== "string" ||
      !source.label.trim() ||
      (source.storeId !== null && typeof source.storeId !== "string") ||
      (source.source === "edge" && typeof source.storeId !== "string") ||
      (source.source === "edge" && !UUID.test(String(source.storeId))) ||
      (source.source !== "edge" && source.storeId !== null)
    ) {
      throw new Error("Invalid sales insights source")
    }
    return {
      source: source.source as SalesSourceOption["source"],
      storeId: source.storeId as string | null,
      label: source.label,
    }
  }
  const scope = parseSource(row.scope)
  const availableSources = row.availableSources.map(parseSource)
  if (
    !availableSources.some(
      (source) =>
        source.source === scope.source && source.storeId === scope.storeId
    )
  ) {
    throw new Error("Invalid sales insights source")
  }
  const lag = row.reportingLag as Record<string, unknown>
  if (
    !["current", "lagging", "not_configured"].includes(String(lag.status)) ||
    !integer(lag.pendingEvents) ||
    !integer(lag.receivedEvents) ||
    !integer(lag.projectedEvents) ||
    (lag.latestReceivedAt !== null && !isDate(lag.latestReceivedAt)) ||
    lag.projectedEvents > lag.receivedEvents
  ) {
    throw new Error("Invalid sales reporting lag")
  }
  const coverage = row.coverage as Record<string, unknown>
  if (
    coverage.synchronizedReturns !== "not_applicable" &&
    coverage.synchronizedReturns !== "not_available"
  ) {
    throw new Error("Invalid sales reporting coverage")
  }
  const summary = row.summary as Record<string, unknown>
  const summaryFields = [
    "saleCount",
    "grossSalesMinor",
    "refundCount",
    "refundMinor",
    "averageBasketMinor",
    "activeCashierCount",
  ]
  if (
    summaryFields.some((field) => !integer(summary[field])) ||
    !integer(summary.netSalesMinor, true)
  ) {
    throw new Error("Invalid sales insights summary")
  }

  const daily = row.daily.map((value) => {
    if (!value || typeof value !== "object") {
      throw new Error("Invalid daily sales insight")
    }
    const day = value as Record<string, unknown>
    if (
      !isDay(day.day) ||
      !integer(day.saleCount) ||
      !integer(day.grossSalesMinor) ||
      !integer(day.refundMinor) ||
      !integer(day.netSalesMinor, true)
    ) {
      throw new Error("Invalid daily sales insight")
    }
    return {
      day: day.day,
      saleCount: day.saleCount,
      grossSalesMinor: day.grossSalesMinor,
      refundMinor: day.refundMinor,
      netSalesMinor: day.netSalesMinor,
    }
  })

  const cashiers = row.cashiers.map((value) => {
    if (!value || typeof value !== "object") {
      throw new Error("Invalid cashier sales insight")
    }
    const cashier = value as Record<string, unknown>
    const positiveFields = [
      "saleCount",
      "grossSalesMinor",
      "refundMinor",
      "averageBasketMinor",
    ]
    if (
      typeof cashier.cashierId !== "string" ||
      typeof cashier.cashierName !== "string" ||
      (cashier.source !== "operational" && cashier.source !== "edge") ||
      (cashier.storeId !== null && typeof cashier.storeId !== "string") ||
      (cashier.source === "edge" && typeof cashier.storeId !== "string") ||
      (cashier.source === "edge" && !UUID.test(String(cashier.storeId))) ||
      (cashier.source === "operational" && cashier.storeId !== null) ||
      positiveFields.some((field) => !integer(cashier[field])) ||
      !integer(cashier.netSalesMinor, true)
    ) {
      throw new Error("Invalid cashier sales insight")
    }
    return {
      cashierId: cashier.cashierId,
      cashierName: cashier.cashierName,
      source: cashier.source as "operational" | "edge",
      storeId: cashier.storeId as string | null,
      saleCount: cashier.saleCount as number,
      grossSalesMinor: cashier.grossSalesMinor as number,
      refundMinor: cashier.refundMinor as number,
      netSalesMinor: cashier.netSalesMinor as number,
      averageBasketMinor: cashier.averageBasketMinor as number,
    }
  })

  const paymentMix = row.paymentMix.map((value) => {
    if (!value || typeof value !== "object") {
      throw new Error("Invalid payment sales insight")
    }
    const payment = value as Record<string, unknown>
    if (
      !["cash", "card", "mpesa"].includes(String(payment.kind)) ||
      !integer(payment.paymentCount) ||
      !integer(payment.amountMinor)
    ) {
      throw new Error("Invalid payment sales insight")
    }
    return {
      kind: payment.kind as "cash" | "card" | "mpesa",
      paymentCount: payment.paymentCount,
      amountMinor: payment.amountMinor,
    }
  })

  const topProducts = row.topProducts.map((value) => {
    if (!value || typeof value !== "object") {
      throw new Error("Invalid product sales insight")
    }
    const product = value as Record<string, unknown>
    if (
      typeof product.productId !== "string" ||
      typeof product.productName !== "string" ||
      (product.source !== "operational" && product.source !== "edge") ||
      (product.storeId !== null && typeof product.storeId !== "string") ||
      (product.source === "edge" && typeof product.storeId !== "string") ||
      (product.source === "edge" && !UUID.test(String(product.storeId))) ||
      (product.source === "operational" && product.storeId !== null) ||
      !["each", "pack", "kg", "l"].includes(String(product.unit)) ||
      !integer(product.quantityMinor) ||
      !integer(product.grossSalesMinor) ||
      !integer(product.saleCount)
    ) {
      throw new Error("Invalid product sales insight")
    }
    return {
      productId: product.productId,
      productName: product.productName,
      source: product.source as "operational" | "edge",
      storeId: product.storeId as string | null,
      unit: product.unit as "each" | "pack" | "kg" | "l",
      quantityMinor: product.quantityMinor,
      grossSalesMinor: product.grossSalesMinor,
      saleCount: product.saleCount,
    }
  })

  return {
    from: row.from,
    to: row.to,
    days: row.days,
    scope,
    availableSources,
    reportingLag: {
      status: lag.status as SalesInsights["reportingLag"]["status"],
      pendingEvents: lag.pendingEvents as number,
      receivedEvents: lag.receivedEvents as number,
      projectedEvents: lag.projectedEvents as number,
      latestReceivedAt: lag.latestReceivedAt as string | null,
    },
    coverage: {
      synchronizedReturns:
        coverage.synchronizedReturns as SalesInsights["coverage"]["synchronizedReturns"],
    },
    summary: {
      saleCount: summary.saleCount as number,
      grossSalesMinor: summary.grossSalesMinor as number,
      refundCount: summary.refundCount as number,
      refundMinor: summary.refundMinor as number,
      netSalesMinor: summary.netSalesMinor as number,
      averageBasketMinor: summary.averageBasketMinor as number,
      activeCashierCount: summary.activeCashierCount as number,
    },
    daily,
    cashiers,
    paymentMix,
    topProducts,
  }
}

export async function getSalesInsights(
  from: string,
  to: string,
  source?: SalesSourceOption,
  signal?: AbortSignal
): Promise<SalesInsights> {
  const parameters = new URLSearchParams({ from, to })
  if (source) {
    parameters.set("source", source.source)
    if (source.storeId) parameters.set("storeId", source.storeId)
  }
  const response = await fetch(`/api/reports/sales?${parameters}`, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  })
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
        : "Sales insights could not be loaded. Please retry."
    throw new Error(message)
  }
  return parseSalesInsights(result)
}
