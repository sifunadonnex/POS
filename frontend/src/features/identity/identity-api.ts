export type Staff = {
  id: string
  name: string
  email: string
  role: "manager" | "cashier"
}

export async function getStaff(signal: AbortSignal): Promise<Staff | null> {
  const response = await fetch("/api/identity/me", {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  })
  if (response.status === 401) return null
  if (!response.ok)
    throw new Error("Unable to verify staff access. Please retry.")
  const data: unknown = await response.json()
  if (!data || typeof data !== "object" || !("user" in data))
    throw new Error("Invalid response")
  const user = data.user
  if (
    !user ||
    typeof user !== "object" ||
    !("id" in user) ||
    typeof user.id !== "string" ||
    !("name" in user) ||
    typeof user.name !== "string" ||
    !("email" in user) ||
    typeof user.email !== "string" ||
    !("role" in user) ||
    (user.role !== "manager" && user.role !== "cashier")
  )
    throw new Error("Invalid response")
  return { id: user.id, name: user.name, email: user.email, role: user.role }
}
