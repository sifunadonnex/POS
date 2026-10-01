import { expect, it } from "vitest"
import { formatKes, formatNairobiDateTime } from "./format"

it("formats Kenyan money consistently from exact minor units", () => {
  expect(formatKes(123456)).toBe("KES 1,234.56")
  expect(formatKes(-50n)).toBe("-KES 0.50")
})

it("formats operational timestamps in Nairobi time", () => {
  const formatted = formatNairobiDateTime("2026-09-21T08:00:00.000Z")
  expect(formatted).toContain("21 Sept 2026")
  expect(formatted).toContain("11:00")
})
