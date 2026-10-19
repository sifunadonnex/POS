export type Department = {
  id: string
  name: string
  branchId: string
  branchName: string
  home: boolean
}
export type Till = { id: string; name: string; departmentId: string }
export type BusinessConfiguration = {
  departments: Department[]
  tills: Till[]
  settings: { expiryWarningDays: number | null; revision: number }
}

export function businessHeaders(): Record<string, string> {
  const department = sessionStorage.getItem("paygo-department")
  const till = sessionStorage.getItem("paygo-till")
  return {
    ...(department ? { "X-Paygo-Department": department } : {}),
    ...(till ? { "X-Paygo-Till": till } : {}),
  }
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid business response")
  return Object.fromEntries(Object.entries(value))
}
export function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid business response")
  return value
}
export function parseConfiguration(value: unknown): BusinessConfiguration {
  const data = record(value),
    settings = record(data.settings)
  if (
    !Array.isArray(data.departments) ||
    !Array.isArray(data.tills) ||
    typeof settings.revision !== "number" ||
    !Number.isInteger(settings.revision) ||
    (settings.expiryWarningDays !== null &&
      (typeof settings.expiryWarningDays !== "number" ||
        !Number.isInteger(settings.expiryWarningDays)))
  )
    throw new Error("Invalid business configuration")
  return {
    departments: data.departments.map((value) => {
      const d = record(value)
      return {
        id: text(d.id),
        name: text(d.name),
        branchId: text(d.branchId),
        branchName: text(d.branchName),
        home: d.home === true,
      }
    }),
    tills: data.tills.map((value) => {
      const t = record(value)
      return {
        id: text(t.id),
        name: text(t.name),
        departmentId: text(t.departmentId),
      }
    }),
    settings: {
      expiryWarningDays: settings.expiryWarningDays,
      revision: settings.revision,
    },
  }
}
export async function businessRequest(
  path = "",
  body?: unknown
): Promise<unknown> {
  const response = await fetch(`/api/business${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  })
  if (response.status === 401)
    window.dispatchEvent(new Event("paygo-session-expired"))
  const value: unknown = await response.json()
  if (!response.ok)
    throw new Error(
      typeof record(value).message === "string"
        ? text(record(value).message)
        : "Business settings are unavailable. Please retry."
    )
  return value
}
export async function getBusinessConfiguration() {
  return parseConfiguration(await businessRequest())
}
