import { useEffect, useRef, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  UserPlus,
  ShieldCheck,
  UserRound,
  Mail,
  Trash2,
  RotateCcw,
} from "lucide-react"
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
  const [status, setStatus] = useState("all")
  const [removalArmed, setRemovalArmed] = useState(false)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [selected, setSelected] = useState<StaffAccount | null>(null)
  const [editing, setEditing] = useState(false)
  const [role, setRole] = useState<"manager" | "supervisor" | "cashier">(
    "cashier"
  )
  const [disabled, setDisabled] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const busy = useRef(false)
  useEffect(() => {
    let current = true
    void listStaff(search, page, status)
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
  }, [search, page, revision, status])
  function reload() {
    setLoading(true)
    setRevision((value) => value + 1)
  }
  function edit(row: StaffAccount | null) {
    setSelected(row)
    setRole(row?.role ?? "cashier")
    setDisabled(row?.disabled ?? false)
    setEditing(true)
    setRemovalArmed(false)
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
          {
            ...confirmation,
            ...(["archive", "restore"].includes(action)
              ? { revision: selected.revision }
              : {}),
          }
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
          action === "archive"
            ? "Staff account removed. Sign-in is disabled; sales and audit history are retained."
            : action === "restore"
              ? "Account restored as suspended. Review access before activating it."
              : action.startsWith("send-")
                ? "Email link requested. Delivery is recorded in security history."
                : action === "reset-mfa"
                  ? "Authenticator reset and sessions revoked. The staff member must enroll again."
                  : "Sessions revoked. The staff member must sign in again."
        )
        if (["reset-mfa", "archive", "restore"].includes(action)) {
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
          <h2 className="text-xl font-semibold tracking-tight">Your team</h2>
          <p className="text-sm text-muted-foreground">
            Give each person the right access, and keep account recovery within
            reach.
          </p>
        </div>
        <Button onClick={() => edit(null)} disabled={pending}>
          <UserPlus className="size-4" aria-hidden="true" />
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
      <nav aria-label="Staff account status" className="flex flex-wrap gap-2">
        {(
          [
            ["all", "All staff"],
            ["active", "Active"],
            ["suspended", "Suspended"],
            ["removed", "Removed"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            variant={status === value ? "secondary" : "ghost"}
            className="min-h-10 rounded-full px-4"
            aria-pressed={status === value}
            disabled={pending}
            onClick={() => {
              setLoading(true)
              setStatus(value)
              setPage(0)
            }}
          >
            {label}
          </Button>
        ))}
      </nav>
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
        <div className="rounded-2xl border border-dashed bg-muted/20 p-8 text-center">
          <UserRound
            className="mx-auto size-8 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="mt-3 font-medium">
            No staff accounts match this search.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try another name, email or account status.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-xs"
            >
              <div className="min-w-0">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <div
                    className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                    aria-hidden="true"
                  >
                    {row.name
                      .split(" ")
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((part) => part[0])
                      .join("")
                      .toUpperCase()}
                  </div>
                  <Badge variant={row.disabled ? "outline" : "secondary"}>
                    {row.archived
                      ? "Removed"
                      : row.disabled
                        ? "Suspended"
                        : "Active"}
                  </Badge>
                </div>
                <h3 className="font-medium">
                  {row.name}
                  {row.id === currentUserId ? " (you)" : ""}
                </h3>
                <p className="text-sm break-all text-muted-foreground">
                  {row.email}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="secondary" className="capitalize">
                    {row.role}
                  </Badge>
                  {row.id === currentUserId && (
                    <Badge variant="outline">Your account</Badge>
                  )}
                </div>
                <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                  <p className="flex items-center gap-2">
                    <Mail className="size-3.5" aria-hidden="true" />
                    {row.emailVerified
                      ? "Email verified"
                      : "Email verification needed"}
                  </p>
                  <p className="flex items-center gap-2">
                    <ShieldCheck className="size-3.5" aria-hidden="true" />
                    {row.twoFactorEnabled
                      ? "Authenticator enabled"
                      : row.role === "manager"
                        ? "Authenticator required for manager access"
                        : "Authenticator not enabled"}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                className="mt-auto min-h-10 w-full"
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
      <Dialog
        open={editing}
        onOpenChange={(open) => {
          if (!pending) setEditing(open)
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-h-[90svh] overflow-y-auto rounded-2xl p-5 motion-reduce:animate-none sm:max-w-2xl sm:p-6"
        >
          <DialogTitle className="text-xl font-semibold tracking-tight">
            {selected ? `Manage ${selected.name}` : "Create staff account"}
          </DialogTitle>
          <DialogDescription>
            Review profile and access, then confirm changes with your password.
            Every action is recorded.
          </DialogDescription>
          <form
            key={selected?.id ?? "new"}
            onSubmit={submit}
            className="space-y-5"
            aria-label={
              selected ? "Manage staff account" : "Create staff account"
            }
            aria-busy={pending}
          >
            <div className="space-y-2">
              <Label htmlFor="staff-name">Full name</Label>
              <Input
                id="staff-name"
                name="staff-name"
                defaultValue={selected?.name ?? ""}
                required
                maxLength={100}
                disabled={pending || selected?.archived}
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
                {(["cashier", "supervisor", "manager"] as const).map(
                  (value) => (
                    <Button
                      type="button"
                      key={value}
                      variant={role === value ? "secondary" : "outline"}
                      aria-pressed={role === value}
                      disabled={
                        pending ||
                        selected?.id === currentUserId ||
                        selected?.archived
                      }
                      onClick={() => setRole(value)}
                    >
                      {value === "manager"
                        ? "Manager"
                        : value === "supervisor"
                          ? "Supervisor"
                          : "Cashier"}
                    </Button>
                  )
                )}
              </div>
            </fieldset>
            {selected && !selected.archived && (
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
              {!selected?.archived && (
                <Button type="submit" data-action="save" disabled={pending}>
                  {pending
                    ? "Working…"
                    : selected
                      ? "Save account"
                      : "Create account"}
                </Button>
              )}
              {selected?.archived && (
                <Button type="submit" data-action="restore" disabled={pending}>
                  <RotateCcw className="size-4" aria-hidden="true" />
                  Restore as suspended
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => setEditing(false)}
              >
                Close
              </Button>
            </div>
            {selected && !selected.archived && (
              <div className="flex flex-wrap gap-2 border-t pt-4">
                <div className="mb-1 w-full">
                  <h4 className="font-medium">Recovery and sessions</h4>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Send a link to the staff member, or end access on their
                    signed-in devices.
                  </p>
                </div>
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
            {selected &&
              !selected.archived &&
              selected.id !== currentUserId && (
                <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4">
                  <h4 className="font-medium">Remove from your team</h4>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Removal disables sign-in and keeps sales, audit history and
                    the email identity. You can restore the account from Removed
                    staff.
                  </p>
                  {removalArmed ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="submit"
                        data-action="archive"
                        variant="destructive"
                        disabled={pending}
                      >
                        Confirm removal
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => setRemovalArmed(false)}
                      >
                        Cancel removal
                      </Button>
                    </div>
                  ) : (
                    <Button
                      className="mt-3"
                      type="button"
                      variant="destructive"
                      disabled={pending}
                      onClick={() => setRemovalArmed(true)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      Remove staff account
                    </Button>
                  )}
                </div>
              )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {message && (
              <p role="status" className="rounded-xl bg-muted/40 p-3 text-sm">
                {message}
              </p>
            )}
          </form>
        </DialogContent>
      </Dialog>
      {!editing && error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!editing && message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  )
}
