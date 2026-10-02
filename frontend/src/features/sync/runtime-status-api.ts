export type RuntimeStatus = {
  mode: "hosted" | "edge"
  storeId: string | null
  checkoutAuthority: "hosted" | "local"
  syncConfigured: boolean
  pendingEvents: number
  oldestPendingAt: string | null
  deliveredEvents: number
  latestDeliveredAt: string | null
  receivedEvents: number
  latestReceivedAt: string | null
  projectedEvents: number
  unprojectedEvents: number
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid runtime status response")
  }
  return value as Record<string, unknown>
}

export async function getRuntimeStatus(
  signal?: AbortSignal
): Promise<RuntimeStatus> {
  const response = await fetch("/api/sync/status", {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  })
  if (response.status === 401) {
    window.dispatchEvent(new Event("paygo-session-expired"))
  }
  if (!response.ok) throw new Error("Runtime status is unavailable")
  const row = object(await response.json())
  if (
    (row.mode !== "hosted" && row.mode !== "edge") ||
    (row.storeId !== null && typeof row.storeId !== "string") ||
    (row.checkoutAuthority !== "hosted" && row.checkoutAuthority !== "local") ||
    typeof row.syncConfigured !== "boolean" ||
    typeof row.pendingEvents !== "number" ||
    !Number.isSafeInteger(row.pendingEvents) ||
    row.pendingEvents < 0 ||
    typeof row.deliveredEvents !== "number" ||
    !Number.isSafeInteger(row.deliveredEvents) ||
    row.deliveredEvents < 0 ||
    typeof row.receivedEvents !== "number" ||
    !Number.isSafeInteger(row.receivedEvents) ||
    row.receivedEvents < 0 ||
    typeof row.projectedEvents !== "number" ||
    !Number.isSafeInteger(row.projectedEvents) ||
    row.projectedEvents < 0 ||
    typeof row.unprojectedEvents !== "number" ||
    !Number.isSafeInteger(row.unprojectedEvents) ||
    row.unprojectedEvents < 0 ||
    (row.oldestPendingAt !== null &&
      (typeof row.oldestPendingAt !== "string" ||
        !Number.isFinite(Date.parse(row.oldestPendingAt)))) ||
    (row.latestDeliveredAt !== null &&
      (typeof row.latestDeliveredAt !== "string" ||
        !Number.isFinite(Date.parse(row.latestDeliveredAt)))) ||
    (row.latestReceivedAt !== null &&
      (typeof row.latestReceivedAt !== "string" ||
        !Number.isFinite(Date.parse(row.latestReceivedAt)))) ||
    (row.mode === "hosted" &&
      (row.checkoutAuthority !== "hosted" ||
        (row.syncConfigured
          ? typeof row.storeId !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              row.storeId
            )
          : row.storeId !== null))) ||
    (row.mode === "edge" &&
      (typeof row.storeId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          row.storeId
        ) ||
        row.checkoutAuthority !== "local"))
  ) {
    throw new Error("Invalid runtime status response")
  }
  return {
    mode: row.mode,
    storeId: row.storeId,
    checkoutAuthority: row.checkoutAuthority,
    syncConfigured: row.syncConfigured,
    pendingEvents: row.pendingEvents,
    oldestPendingAt: row.oldestPendingAt,
    deliveredEvents: row.deliveredEvents,
    latestDeliveredAt: row.latestDeliveredAt,
    receivedEvents: row.receivedEvents,
    latestReceivedAt: row.latestReceivedAt,
    projectedEvents: row.projectedEvents,
    unprojectedEvents: row.unprojectedEvents,
  }
}
