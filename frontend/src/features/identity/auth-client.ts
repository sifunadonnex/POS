import { createAuthClient } from "better-auth/react"

// Same-origin /api requests are proxied to Nest by Vite locally.
export const authClient = createAuthClient({
  fetchOptions: { timeout: 10_000, credentials: "same-origin" },
})
