import { useEffect, useRef, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { identityRequest } from "./identity-api"
import { PasswordField } from "./security-fields"
import { errorText, formText } from "./security-form"
import {
  listStaff,
  parseStaffAccount,
  type StaffAccount,
} from "./staff-admin-api"

export function StaffAdminScreen({ currentUserId }: { currentUserId: string }) {
  const [rows, setRows] = useState<StaffAccount[]>([])
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [selected, setSelected] = useState<StaffAccount | null>(null)
  const [editing, setEditing] = useState(false)
  const [role, setRole] = useState<"manager" | "cashier">("cashier")
  const [disabled, setDisabled] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const busy = useRef(false)
  useEffect(() => {
    let current = true
    void listStaff(search, page)
      .then((result) => {
        if (current) {
          setRows(result.staff)
          setHasMore(result.hasMore)
          setLoadError("")
        }
      })
      .catch((failure: unknown) => {
        if (current) {
          setRows([])
          setLoadError(errorText(failure))
        }
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [search, page, revision])
  function reload() {
    setLoading(true)
    setRevision((value) => value + 1)
  }
  function edit(row: StaffAccount | null) {
    setSelected(row)
    setRole(row?.role ?? "cashier")
    setDisabled(row?.disabled ?? false)
    setEditing(true)
    setError("")
    setMessage("")
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current) return
    const form = event.currentTarget
    const data = new FormData(form)
    const submitter =
      "submitter" in event.nativeEvent ? event.nativeEvent.submitter : null
    const action =
      submitter instanceof HTMLElement
        ? (submitter.dataset.action ?? "save")
        : "save"
    busy.current = true
    setPending(true)
    setError("")
    setMessage("")
    try {
      const confirmation = {
        password: formText(data, "admin-password"),
        reason: formText(data, "reason").trim(),
      }
      if (action === "save") {
        const result = await identityRequest(
          selected ? `staff/${encodeURIComponent(selected.id)}` : "staff",
          {
            ...confirmation,
            name: formText(data, "staff-name").trim(),
            role,
            ...(selected
              ? { disabled, revision: selected.revision }
              : { email: formText(data, "staff-email").trim() }),
          },
          selected ? "PATCH" : "POST"
        )
        if (!result || typeof result !== "object" || !("staff" in result))
          throw new Error(
            "Save could not be confirmed. Reload before retrying."
          )
        const saved = parseStaffAccount(result.staff)
        setSelected(saved)
        setRole(saved.role)
        setDisabled(saved.disabled)
        setMessage(
          selected
            ? "Staff account updated."
            : "Account created. Request verification and password-setup links below so this staff member can sign in."
        )
      } else if (selected) {
        const result = await identityRequest(
          `staff/${encodeURIComponent(selected.id)}/${action}`,
          confirmation
        )
        if (
          !result ||
          typeof result !== "object" ||
          !("status" in result) ||
          result.status !== true
        )
          throw new Error(
            "The action could not be confirmed. Reload before retrying."
          )
        setMessage(
          action.startsWith("send-")
            ? "Email link requested. Delivery is recorded in security history."
            : action === "reset-mfa"
              ? "Authenticator reset and sessions revoked. The staff member must enroll again."
              : "Sessions revoked. The staff member must sign in again."
        )
        if (action === "reset-mfa") {
          setEditing(false)
          setSelected(null)
        }
        if (action === "revoke-sessions" && selected.id === currentUserId)
          window.dispatchEvent(new Event("paygo-session-expired"))
      }
      reload()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      const password = form.elements.namedItem("admin-password")
      if (password instanceof HTMLInputElement) password.value = ""
      busy.current = false
      setPending(false)
    }
  }
  return (
    <section className="space-y-5" aria-label="Staff administration">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Staff accounts</h2>
          <p className="text-sm text-muted-foreground">
            Create individual accounts and manage their access.
          </p>
        </div>
        <Button onClick={() => edit(null)} disabled={pending}>
          New staff account
        </Button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const value = formText(new FormData(event.currentTarget), "search")
          setLoading(true)
          setSearch(value)
          setPage(0)
          setRevision((v) => v + 1)
        }}
        className="flex items-end gap-2"
      >
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="staff-search">Search name or email</Label>
          <Input id="staff-search" name="search" maxLength={100} />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          Search
        </Button>
      </form>
      {loading ? (
        <p role="status">Loading staff accounts…</p>
      ) : loadError ? (
        <div className="space-y-3">
          <p role="alert">{loadError}</p>
          <Button variant="outline" onClick={reload}>
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p>No staff accounts match this search.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
            >
              <div className="min-w-0">
                <h3 className="font-medium">
                  {row.name}
                  {row.id === currentUserId ? " (you)" : ""}
                </h3>
                <p className="text-sm break-all text-muted-foreground">
                  {row.email}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.role} · {row.disabled ? "Suspended" : "Active"} ·{" "}
                  {row.emailVerified
                    ? "Email verified"
                    : "Email verification needed"}{" "}
                  · {row.twoFactorEnabled ? "MFA enabled" : "MFA not enabled"}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => edit(row)}
                disabled={pending}
              >
                Manage {row.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-between gap-2">
        <Button
          variant="outline"
          disabled={page === 0 || loading || pending}
          onClick={() => {
            setLoading(true)
            setPage((value) => value - 1)
          }}
        >
          Previous
        </Button>
        <span className="self-center text-sm text-muted-foreground">
          Page {page + 1}
        </span>
        <Button
          variant="outline"
          disabled={!hasMore || loading || pending}
          onClick={() => {
            setLoading(true)
            setPage((value) => value + 1)
          }}
        >
          Next
        </Button>
      </div>
      {editing && (
        <form
          key={selected?.id ?? "new"}
          onSubmit={submit}
          className="space-y-4 rounded-xl border bg-muted/20 p-4 sm:p-6"
          aria-label={
            selected ? "Manage staff account" : "Create staff account"
          }
          aria-busy={pending}
        >
          <h3 className="font-semibold">
            {selected ? `Manage ${selected.name}` : "Create staff account"}
          </h3>
          <div className="space-y-2">
            <Label htmlFor="staff-name">Full name</Label>
            <Input
              id="staff-name"
              name="staff-name"
              defaultValue={selected?.name ?? ""}
              required
              maxLength={100}
              disabled={pending}
            />
          </div>
          {selected ? (
            <p className="text-sm break-all text-muted-foreground">
              {selected.email}
            </p>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="staff-email">Staff email</Label>
              <Input
                id="staff-email"
                name="staff-email"
                type="email"
                autoComplete="off"
                required
                maxLength={254}
                disabled={pending}
              />
            </div>
          )}
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Role</legend>
            <div className="flex gap-2">
              {(["cashier", "manager"] as const).map((value) => (
                <Button
                  type="button"
                  key={value}
                  variant={role === value ? "secondary" : "outline"}
                  aria-pressed={role === value}
                  disabled={pending || selected?.id === currentUserId}
                  onClick={() => setRole(value)}
                >
                  {value === "manager" ? "Manager" : "Cashier"}
                </Button>
              ))}
            </div>
          </fieldset>
          {selected && (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">
                Account status
              </legend>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={!disabled ? "secondary" : "outline"}
                  aria-pressed={!disabled}
                  disabled={pending}
                  onClick={() => setDisabled(false)}
                >
                  Active
                </Button>
                <Button
                  type="button"
                  variant={disabled ? "secondary" : "outline"}
                  aria-pressed={disabled}
                  disabled={pending || selected.id === currentUserId}
                  onClick={() => setDisabled(true)}
                >
                  Suspended
                </Button>
              </div>
            </fieldset>
          )}
          <div className="space-y-2">
            <Label htmlFor="reason">Reason for this action</Label>
            <Input
              id="reason"
              name="reason"
              required
              minLength={3}
              maxLength={200}
              disabled={pending}
            />
          </div>
          <PasswordField
            id="admin-password"
            label="Your current password"
            disabled={pending}
          />
          <p className="text-sm text-muted-foreground">
            Every action is recorded. Role changes and suspensions revoke the
            affected account’s sessions.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" data-action="save" disabled={pending}>
              {pending
                ? "Working…"
                : selected
                  ? "Save account"
                  : "Create account"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              Close
            </Button>
          </div>
          {selected && (
            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button
                type="submit"
                data-action="send-verification"
                variant="outline"
                disabled={pending || selected.emailVerified}
              >
                Request verification link
              </Button>
              <Button
                type="submit"
                data-action="send-reset"
                variant="outline"
                disabled={pending}
              >
                Request password-setup link
              </Button>
              <Button
                type="submit"
                data-action="revoke-sessions"
                variant="outline"
                disabled={pending}
              >
                Revoke sessions
              </Button>
              <Button
                type="submit"
                data-action="reset-mfa"
                variant="destructive"
                disabled={pending || selected.id === currentUserId}
              >
                Reset authenticator
              </Button>
            </div>
          )}
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  )
}
