import { afterEach, expect, it, vi } from "vitest"
import {
  getPaymentCapabilities,
  reconcilePaymentAttempt,
  startPaymentAttempt,
} from "./payment-attempts-api"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const confirmedAttempt = {
  attemptId: "11111111-1111-4111-8111-111111111111",
  saleId: "22222222-2222-4222-8222-222222222222",
  shiftId: "33333333-3333-4333-8333-333333333333",
  kind: "mpesa",
  provider: "verified-provider",
  providerReference: "provider-reference",
  amountMinor: 1250,
  status: "confirmed",
  paymentId: "44444444-4444-4444-8444-444444444444",
  createdAt: "2026-09-28T08:00:00.000Z",
  updatedAt: "2026-09-28T08:00:01.000Z",
  confirmedAt: "2026-09-28T08:00:01.000Z",
}

it("loads the external payment methods enabled by the server", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ card: false, mpesa: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  )
  vi.stubGlobal("fetch", fetch)

  await expect(getPaymentCapabilities()).resolves.toEqual({
    card: false,
    mpesa: true,
  })
  expect(fetch).toHaveBeenCalledWith(
    "/api/payment-attempts/capabilities",
    expect.objectContaining({ method: "GET", credentials: "same-origin" })
  )
})

it("starts and reconciles a replay-safe external payment attempt", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify(confirmedAttempt), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify(confirmedAttempt), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
  vi.stubGlobal("fetch", fetch)

  await expect(
    startPaymentAttempt(
      confirmedAttempt.saleId,
      "mpesa",
      "55555555-5555-4555-8555-555555555555",
      "0712345678"
    )
  ).resolves.toMatchObject({ status: "confirmed" })
  await expect(
    reconcilePaymentAttempt(confirmedAttempt.attemptId)
  ).resolves.toMatchObject({ paymentId: confirmedAttempt.paymentId })

  expect(fetch).toHaveBeenNthCalledWith(
    1,
    "/api/payment-attempts",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        saleId: confirmedAttempt.saleId,
        kind: "mpesa",
        requestId: "55555555-5555-4555-8555-555555555555",
        payerPhone: "0712345678",
        reason: "mpesa register payment",
      }),
    })
  )
  expect(fetch).toHaveBeenNthCalledWith(
    2,
    `/api/payment-attempts/${confirmedAttempt.attemptId}/reconcile`,
    expect.objectContaining({ method: "POST" })
  )
})
