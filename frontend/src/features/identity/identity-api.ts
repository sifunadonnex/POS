export type Staff = {
  id: string
  name: string
  email: string
  role: "manager" | "cashier"
  emailVerified: boolean
  twoFactorEnabled: boolean
  mfaRequired: boolean
  idleSeconds: number
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
    (user.role !== "manager" && user.role !== "cashier") ||
    !("emailVerified" in user) ||
    typeof user.emailVerified !== "boolean" ||
    !("twoFactorEnabled" in user) ||
    typeof user.twoFactorEnabled !== "boolean" ||
    !("mfaRequired" in user) ||
    typeof user.mfaRequired !== "boolean" ||
    !("idleSeconds" in user) ||
    typeof user.idleSeconds !== "number" ||
    !Number.isInteger(user.idleSeconds) ||
    user.idleSeconds < 60 ||
    user.idleSeconds > 3600
  )
    throw new Error("Invalid response")
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
    twoFactorEnabled: user.twoFactorEnabled,
    mfaRequired: user.mfaRequired,
    idleSeconds: user.idleSeconds,
  }
}

export async function identityRequest(
  path: string,
  body?: unknown,
  method = "POST"
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(`/api/identity/${path}`, {
      method: body === undefined ? "GET" : method,
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
      const message =
        result &&
        typeof result === "object" &&
        "message" in result &&
        typeof result.message === "string"
          ? result.message
          : "The request could not be completed. Please retry."
      throw new Error(message)
    }
    return result
  } catch (error) {
    if (
      error instanceof Error &&
      error.name !== "AbortError" &&
      error.name !== "TypeError"
    )
      throw error
    throw new Error(
      "The request could not be confirmed. Check your connection and reload before retrying.",
      { cause: error }
    )
  } finally {
    window.clearTimeout(timeout)
  }
}
