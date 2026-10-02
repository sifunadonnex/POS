import { afterEach, expect, it, vi } from "vitest"
import { getRuntimeStatus } from "./runtime-status-api"

afterEach(() => vi.unstubAllGlobals())

it("parses a local edge runtime with queued events", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          mode: "edge",
          storeId: "11111111-1111-4111-8111-111111111111",
          checkoutAuthority: "local",
          syncConfigured: false,
          pendingEvents: 3,
          oldestPendingAt: "2026-10-02T10:00:00.000Z",
          deliveredEvents: 2,
          latestDeliveredAt: "2026-10-02T10:30:00.000Z",
          receivedEvents: 0,
          latestReceivedAt: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    )
  )

  await expect(getRuntimeStatus()).resolves.toMatchObject({
    mode: "edge",
    checkoutAuthority: "local",
    pendingEvents: 3,
  })
})

it("rejects malformed counters instead of showing misleading sync state", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          mode: "edge",
          storeId: null,
          checkoutAuthority: "local",
          syncConfigured: false,
          pendingEvents: "3",
          oldestPendingAt: null,
          deliveredEvents: 0,
          latestDeliveredAt: null,
          receivedEvents: 0,
          latestReceivedAt: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    )
  )

  await expect(getRuntimeStatus()).rejects.toThrow("Invalid runtime status")
})
