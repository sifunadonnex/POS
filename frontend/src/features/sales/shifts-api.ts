export type CurrentShift = {
  shiftId: string
  openingCashMinor: number
  status: "open"
  openedAt: string
}

export class ShiftError extends Error {
  readonly status: number

  constructor(message: string, status: number, options?: ErrorOptions) {
    super(message, options)
    this.status = status
  }
}

async function shiftRequest(
  path: string,
  body?: unknown,
  method: "GET" | "POST" = "GET"
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`/api/shifts${path}`, {
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
    if (response.status === 401)
      window.dispatchEvent(new Event("paygo-session-expired"))
    const result: unknown = await response.json()
    if (!response.ok) {
      const value = object(result)
      throw new ShiftError(
        typeof value.message === "string"
          ? value.message
          : "The shift could not be confirmed.",
        response.status
      )
    }
    return result
  } catch (error) {
    if (error instanceof ShiftError) throw error
    throw new ShiftError(
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
    throw new Error("Invalid shift response")
  return Object.fromEntries(Object.entries(value))
}

function integer(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`Invalid ${name} in shift response`)
  return value
}

function parseShift(value: unknown): CurrentShift {
  const row = object(value)
  if (
    typeof row.shiftId !== "string" ||
    row.status !== "open" ||
    typeof row.openedAt !== "string" ||
    !Number.isFinite(Date.parse(row.openedAt))
  )
    throw new Error("Invalid current shift response")
  return {
    shiftId: row.shiftId,
    openingCashMinor: integer(row.openingCashMinor, "opening cash"),
    status: "open",
    openedAt: row.openedAt,
  }
}

export async function getCurrentShift(): Promise<CurrentShift | null> {
  const row = object(await shiftRequest("/current"))
  if (row.shift === null) return null
  return parseShift(row.shift)
}

export async function openShift(
  openingCashMinor: number,
  requestId: string
): Promise<CurrentShift> {
  const row = object(
    await shiftRequest(
      "/open",
      {
        openingCashMinor,
        requestId,
        reason: "Register opening",
      },
      "POST"
    )
  )
  return parseShift(row)
}

export async function closeShift(
  shiftId: string,
  closingCashMinor: number,
  requestId: string
) {
  return shiftRequest(
    `/${encodeURIComponent(shiftId)}/close`,
    {
      closingCashMinor,
      requestId,
      reason: "Register closing",
    },
    "POST"
  )
}
