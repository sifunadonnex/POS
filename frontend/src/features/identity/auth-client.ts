import { createAuthClient } from "better-auth/react"
import { twoFactorClient } from "better-auth/client/plugins"

// Same-origin /api requests are proxied to Nest by Vite locally.
export const authClient = createAuthClient({
  plugins: [twoFactorClient()],
  fetchOptions: { timeout: 10_000, credentials: "same-origin" },
})
