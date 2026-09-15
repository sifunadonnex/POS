export type Recovery = { purpose: "reset" | "verify"; token?: string }

export function readRecoveryLink(): Recovery | null {
  const values = new URLSearchParams(window.location.hash.slice(1))
  const purpose = values.has("reset")
    ? "reset"
    : values.has("verify")
      ? "verify"
      : null
  if (!purpose) return null
  const token = values.get(purpose) ?? ""
  return { purpose, token }
}
