import { identityRequest } from "./identity-api"

export type StaffAccount = {
  id: string
  name: string
  email: string
  role: "manager" | "cashier"
  disabled: boolean
  emailVerified: boolean
  twoFactorEnabled: boolean
  revision: number
}
export type AuditEntry = {
  id: string
  actorId: string | null
  subjectId: string | null
  action: string
  outcome: string
  createdAt: string
  reason?: string
}

export function parseStaffAccount(value: unknown): StaffAccount {
  if (!value || typeof value !== "object")
    throw new Error("Invalid staff response")
  const v = Object.fromEntries(Object.entries(value))
  if (
    typeof v.id !== "string" ||
    typeof v.name !== "string" ||
    typeof v.email !== "string" ||
    (v.role !== "manager" && v.role !== "cashier") ||
    typeof v.disabled !== "boolean" ||
    typeof v.emailVerified !== "boolean" ||
    typeof v.twoFactorEnabled !== "boolean" ||
    typeof v.revision !== "number" ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 1
  )
    throw new Error("Invalid staff response")
  return {
    id: v.id,
    name: v.name,
    email: v.email,
    role: v.role,
    disabled: v.disabled,
    emailVerified: v.emailVerified,
    twoFactorEnabled: v.twoFactorEnabled,
    revision: v.revision,
  }
}

export async function listStaff(search: string, page: number) {
  const result = await identityRequest(
    `staff?${new URLSearchParams({ search, page: String(page) })}`
  )
  if (
    !result ||
    typeof result !== "object" ||
    !("staff" in result) ||
    !Array.isArray(result.staff) ||
    !("hasMore" in result) ||
    typeof result.hasMore !== "boolean"
  )
    throw new Error("Invalid staff response")
  return { staff: result.staff.map(parseStaffAccount), hasMore: result.hasMore }
}

export async function listAudit(before?: string) {
  const result = await identityRequest(
    `audit${before ? `?before=${encodeURIComponent(before)}` : ""}`
  )
  if (
    !result ||
    typeof result !== "object" ||
    !("events" in result) ||
    !Array.isArray(result.events) ||
    !("next" in result) ||
    (result.next !== null && typeof result.next !== "string")
  )
    throw new Error("Invalid security history response")
  const events: AuditEntry[] = result.events.map((item: unknown) => {
    if (!item || typeof item !== "object")
      throw new Error("Invalid security event")
    const v = Object.fromEntries(Object.entries(item))
    if (
      typeof v.id !== "string" ||
      (v.actorId !== null && typeof v.actorId !== "string") ||
      (v.subjectId !== null && typeof v.subjectId !== "string") ||
      typeof v.action !== "string" ||
      typeof v.outcome !== "string" ||
      typeof v.createdAt !== "string" ||
      !Number.isFinite(Date.parse(v.createdAt))
    )
      throw new Error("Invalid security event")
    const detail = v.detail
    const reason =
      detail &&
      typeof detail === "object" &&
      "reason" in detail &&
      typeof detail.reason === "string"
        ? detail.reason
        : undefined
    return {
      id: v.id,
      actorId: v.actorId,
      subjectId: v.subjectId,
      action: v.action,
      outcome: v.outcome,
      createdAt: v.createdAt,
      reason,
    }
  })
  return { events, next: result.next }
}
