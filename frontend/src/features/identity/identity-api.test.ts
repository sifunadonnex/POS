import { afterEach, expect, it, vi } from "vitest"
import { getStaff } from "./identity-api"

afterEach(() => vi.unstubAllGlobals())
it("rejects unexpected roles in server responses", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: "1",
            name: "Staff",
            email: "staff@example.test",
            role: "superuser",
          },
        })
      )
    )
  )
  await expect(getStaff(new AbortController().signal)).rejects.toThrow(
    "Invalid response"
  )
})
it("treats 401 as expired but does not disguise an outage as logout", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
  )
  expect(await getStaff(new AbortController().signal)).toBeNull()
  await expect(getStaff(new AbortController().signal)).rejects.toThrow(
    "Unable to verify"
  )
})
