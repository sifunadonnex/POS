export type ExternalPaymentKind = "card" | "mpesa"
export type PaymentAttemptStatus =
  "pending" | "confirmed" | "failed" | "unknown"

export type PaymentCapabilities = Record<ExternalPaymentKind, boolean>

export type PaymentAttempt = {
  attemptId: string
  saleId: string
  shiftId: string
  kind: ExternalPaymentKind
  provider: string
  providerReference: string | null
  amountMinor: number
  status: PaymentAttemptStatus
  paymentId: string | null
  createdAt: string
  updatedAt: string
  confirmedAt: string | null
}

export class PaymentAttemptError extends Error {
  readonly status: number

  constructor(message: string, status: number, options?: ErrorOptions) {
    super(message, options)
    this.status = status
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid payment response")
  }
  return Object.fromEntries(Object.entries(value))
}

async function paymentRequest(
  path: string,
  body?: unknown,
  method: "GET" | "POST" = "POST"
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`/api/payment-attempts${path}`, {
      method,
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
      throw new PaymentAttemptError(
        typeof value.message === "string"
          ? value.message
          : "The payment could not be confirmed.",
        response.status
      )
    }
    return result
  } catch (error) {
    if (error instanceof PaymentAttemptError) throw error
    throw new PaymentAttemptError(
      "The payment status could not be confirmed. Check your connection and retry.",
      0,
      { cause: error }
    )
  } finally {
    window.clearTimeout(timeout)
  }
}

function paymentKind(value: unknown): value is ExternalPaymentKind {
  return value === "card" || value === "mpesa"
}

function paymentStatus(value: unknown): value is PaymentAttemptStatus {
  return (
    value === "pending" ||
    value === "confirmed" ||
    value === "failed" ||
    value === "unknown"
  )
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null || typeof value === "string") return value
  throw new Error(`Invalid ${label} in payment response`)
}

function date(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Invalid ${label} in payment response`)
  }
  return value
}

function attempt(value: unknown): PaymentAttempt {
  const row = object(value)
  if (
    typeof row.attemptId !== "string" ||
    typeof row.saleId !== "string" ||
    typeof row.shiftId !== "string" ||
    !paymentKind(row.kind) ||
    typeof row.provider !== "string" ||
    typeof row.amountMinor !== "number" ||
    !Number.isSafeInteger(row.amountMinor) ||
    row.amountMinor <= 0 ||
    !paymentStatus(row.status)
  ) {
    throw new Error("Invalid payment attempt response")
  }
  const confirmedAt = nullableString(row.confirmedAt, "confirmation date")
  if (confirmedAt !== null) date(confirmedAt, "confirmation date")
  return {
    attemptId: row.attemptId,
    saleId: row.saleId,
    shiftId: row.shiftId,
    kind: row.kind,
    provider: row.provider,
    providerReference: nullableString(
      row.providerReference,
      "provider reference"
    ),
    amountMinor: row.amountMinor,
    status: row.status,
    paymentId: nullableString(row.paymentId, "payment ID"),
    createdAt: date(row.createdAt, "creation date"),
    updatedAt: date(row.updatedAt, "update date"),
    confirmedAt,
  }
}

export async function getPaymentCapabilities(): Promise<PaymentCapabilities> {
  const row = object(await paymentRequest("/capabilities", undefined, "GET"))
  if (typeof row.card !== "boolean" || typeof row.mpesa !== "boolean") {
    throw new Error("Invalid payment capability response")
  }
  return { card: row.card, mpesa: row.mpesa }
}

export async function startPaymentAttempt(
  saleId: string,
  kind: ExternalPaymentKind,
  requestId: string
): Promise<PaymentAttempt> {
  return attempt(
    await paymentRequest("", {
      saleId,
      kind,
      requestId,
      reason: `${kind} register payment`,
    })
  )
}

export async function reconcilePaymentAttempt(
  attemptId: string
): Promise<PaymentAttempt> {
  return attempt(
    await paymentRequest(`/${encodeURIComponent(attemptId)}/reconcile`)
  )
}
