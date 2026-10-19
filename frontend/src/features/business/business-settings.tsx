import { useEffect, useState, type FormEvent } from "react"
import { ValuationPanel } from "../inventory/valuation-panel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import {
  businessRequest,
  getBusinessConfiguration,
  record,
  text,
  type BusinessConfiguration,
} from "./business-api"

type Member = { id: string; name: string; role: string }
type Assignment = {
  userId: string
  departmentId: string
  home: boolean
  expiresAt: string | null
}
export function BusinessSettings() {
  const [openShifts, setOpenShifts] = useState<
    { id: string; staffName: string; tillName: string }[]
  >([])
  const [shiftId, setShiftId] = useState("")
  const [config, setConfig] = useState<BusinessConfiguration | null>(null)
  const [unassigned, setUnassigned] = useState<
    {
      id: string
      name: string
      sku: string
      quantityMinor: string
      unit: string
      revision: number
    }[]
  >([])
  const [productId, setProductId] = useState("")
  const [productDepartment, setProductDepartment] = useState("")
  const [members, setMembers] = useState<Member[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [reload, setReload] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [userId, setUserId] = useState("")
  const [homeId, setHomeId] = useState("")
  const [coverId, setCoverId] = useState("")
  useEffect(() => {
    let current = true
    void Promise.all([
      getBusinessConfiguration(),
      businessRequest("/administration"),
    ])
      .then(([configuration, value]) => {
        const data = record(value)
        if (!Array.isArray(data.staff) || !Array.isArray(data.assignments))
          throw new Error("Invalid staff access response")
        if (!Array.isArray(data.openShifts))
          throw new Error("Invalid open shifts response")
        const shifts = data.openShifts.map((value) => {
          const row = record(value)
          return {
            id: text(row.id),
            staffName: text(row.staffName),
            tillName: text(row.tillName),
          }
        })
        const staff = data.staff.map((value) => {
          const s = record(value)
          return { id: text(s.id), name: text(s.name), role: text(s.role) }
        })
        const access = data.assignments.map((value) => {
          const a = record(value)
          return {
            userId: text(a.userId),
            departmentId: text(a.departmentId),
            home: a.home === true,
            expiresAt: a.expiresAt === null ? null : text(a.expiresAt),
          }
        })
        if (!Array.isArray(data.unassignedProducts))
          throw new Error("Invalid product assignment response")
        const products = data.unassignedProducts.map((value) => {
          const p = record(value)
          if (typeof p.revision !== "number")
            throw new Error("Invalid product revision")
          return {
            id: text(p.id),
            name: text(p.name),
            sku: text(p.sku),
            quantityMinor: text(p.quantityMinor),
            unit: text(p.unit),
            revision: p.revision,
          }
        })
        if (current) {
          setOpenShifts(shifts)
          setUnassigned(products)
          setConfig(configuration)
          setMembers(staff)
          setAssignments(access)
          setError("")
        }
      })
      .catch((failure: unknown) => {
        if (current)
          setError(
            failure instanceof Error ? failure.message : "Settings unavailable"
          )
      })
    return () => {
      current = false
    }
  }, [reload])
  async function save(
    event: FormEvent<HTMLFormElement>,
    path: string,
    payload: (data: FormData) => unknown
  ) {
    event.preventDefault()
    if (pending) return
    const form = event.currentTarget
    setPending(true)
    setError("")
    setMessage("")
    try {
      await businessRequest(path, payload(new FormData(form)))
      setMessage(
        "Saved. Workspace choices will refresh when you return to the dashboard."
      )
      setReload((n) => n + 1)
      window.dispatchEvent(new Event("paygo-business-changed"))
      form.reset()
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Save could not be confirmed. Reload before retrying."
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="space-y-5">
      {error && (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{error}</p>
          <Button variant="outline" onClick={() => setReload((n) => n + 1)}>
            Reload settings
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {!config ? (
        <p className="text-sm text-muted-foreground">
          {error
            ? "Business settings are unavailable. Retry to load them."
            : "Loading business settings…"}
        </p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Branches & departments</CardTitle>
              <CardDescription>
                Create each real branch here. Every branch has separate Minimart
                and Liquor departments, each with its own till. Existing stock
                remains unassigned until reviewed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-2 text-sm">
                {config.departments.map((d) => (
                  <li key={d.id}>
                    <span className="font-medium">{d.branchName}</span> ·{" "}
                    {d.name}
                  </li>
                ))}
              </ul>
              {config.departments.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No branches configured yet.
                </p>
              )}
              <form
                className="space-y-3"
                onSubmit={(e) =>
                  void save(e, "/branches", (data) => ({
                    id: crypto.randomUUID(),
                    name: data.get("name"),
                    reason: data.get("reason"),
                  }))
                }
              >
                <fieldset disabled={pending} className="space-y-3">
                  <Label htmlFor="branch-name">Branch name</Label>
                  <Input
                    id="branch-name"
                    name="name"
                    required
                    maxLength={100}
                  />
                  <Reason id="branch-reason" />
                  <Button type="submit">Add branch</Button>
                </fieldset>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Assign existing stock</CardTitle>
              <CardDescription>
                Review each unassigned product before allocating its current
                stock. Historical sales remain unassigned. Assigned products
                cannot be moved between departments; use separate product
                records for separate stock.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {unassigned.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No unassigned products.
                </p>
              ) : (
                <form
                  onSubmit={(e) =>
                    void save(e, "/assign-product", (data) => ({
                      productId,
                      departmentId: productDepartment,
                      revision: unassigned.find((p) => p.id === productId)
                        ?.revision,
                      reason: data.get("reason"),
                    }))
                  }
                >
                  <fieldset disabled={pending} className="space-y-3">
                    <Choice
                      id="unassigned-product"
                      label="Product to review"
                      value={productId}
                      onChange={setProductId}
                      items={unassigned.map((p) => ({
                        id: p.id,
                        name: `${p.sku} · ${p.name} (${p.unit === "kg" || p.unit === "l" ? Number(p.quantityMinor) / 1000 : p.quantityMinor} ${p.unit})`,
                      }))}
                    />
                    <Choice
                      id="product-department"
                      label="Destination department"
                      value={productDepartment}
                      onChange={setProductDepartment}
                      items={config.departments.map((d) => ({
                        id: d.id,
                        name: `${d.branchName} · ${d.name}`,
                      }))}
                    />
                    <Reason id="product-assignment-reason" />
                    <Button
                      type="submit"
                      disabled={!productId || !productDepartment}
                    >
                      Assign reviewed product and stock
                    </Button>
                  </fieldset>
                </form>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Expiry alerts</CardTitle>
              <CardDescription>
                Choose when products with a next expiry date appear on the
                dashboard. Expired stocked products remain visible.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-3"
                onSubmit={(e) =>
                  void save(e, "/settings", (data) => ({
                    expiryWarningDays: Number(data.get("days")),
                    revision: config.settings.revision,
                    reason: data.get("reason"),
                  }))
                }
              >
                <fieldset disabled={pending} className="space-y-3">
                  <Label htmlFor="expiry-days">Days before expiry</Label>
                  <Input
                    key={config.settings.revision}
                    id="expiry-days"
                    name="days"
                    type="number"
                    min={0}
                    max={365}
                    required
                    defaultValue={config.settings.expiryWarningDays ?? ""}
                  />
                  <Reason id="expiry-reason" />
                  <Button type="submit">Save expiry warning period</Button>
                </fieldset>
              </form>
            </CardContent>
          </Card>
          {openShifts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Manager shift closure</CardTitle>
                <CardDescription>
                  Count the drawer before closing a staff shift. This also lets
                  a manager close a shift after exceptional cover has expired.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={(event) =>
                    void save(event, "/close-shift", (data) => {
                      const amount = String(data.get("cash") ?? "")
                      if (!/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(amount))
                        throw new Error("Enter a valid counted cash amount")
                      const [whole, fraction = ""] = amount.split(".")
                      return {
                        shiftId,
                        closingCashMinor:
                          Number(whole) * 100 + Number(fraction.padEnd(2, "0")),
                        requestId: crypto.randomUUID(),
                        reason: data.get("reason"),
                      }
                    })
                  }
                >
                  <fieldset disabled={pending} className="space-y-3">
                    <Choice
                      id="manager-close-shift"
                      label="Open shift"
                      value={shiftId}
                      onChange={setShiftId}
                      items={openShifts.map((shift) => ({
                        id: shift.id,
                        name: `${shift.staffName} · ${shift.tillName}`,
                      }))}
                    />
                    <Label htmlFor="counted-cash">
                      Counted drawer cash (KES)
                    </Label>
                    <Input
                      id="counted-cash"
                      name="cash"
                      inputMode="decimal"
                      required
                    />
                    <Reason id="shift-close-reason" />
                    <Button type="submit" disabled={!shiftId}>
                      Close counted shift
                    </Button>
                  </fieldset>
                </form>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Staff department access</CardTitle>
              <CardDescription>
                Assign one home department. Optional cover expires at the time
                you select. Close the staff member’s shift before changing
                access.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 text-sm">
                {members.map((m) => (
                  <p key={m.id}>
                    <span className="font-medium">{m.name}</span> · {m.role} ·{" "}
                    {assignments
                      .filter((a) => a.userId === m.id)
                      .map(
                        (a) =>
                          `${config.departments.find((d) => d.id === a.departmentId)?.name ?? "Unavailable department"}${a.home ? " (home)" : ` (cover until ${a.expiresAt ? new Date(a.expiresAt).toLocaleString() : "unavailable"})`}`
                      )
                      .join(", ") || "Unassigned"}
                  </p>
                ))}
              </div>
              <form
                onSubmit={(e) =>
                  void save(e, "/staff-access", (data) => ({
                    userId,
                    homeDepartmentId: homeId,
                    coverDepartmentId: coverId || null,
                    coverExpiresAt:
                      coverId && data.get("until")
                        ? new Date(String(data.get("until"))).toISOString()
                        : null,
                    reason: data.get("reason"),
                  }))
                }
              >
                <fieldset disabled={pending} className="space-y-3">
                  <Choice
                    id="access-user"
                    label="Staff member"
                    value={userId}
                    onChange={setUserId}
                    items={members.map((m) => ({ id: m.id, name: m.name }))}
                  />
                  <Choice
                    id="access-home"
                    label="Home department"
                    value={homeId}
                    onChange={setHomeId}
                    items={config.departments.map((d) => ({
                      id: d.id,
                      name: `${d.branchName} · ${d.name}`,
                    }))}
                  />
                  <Choice
                    id="access-cover"
                    label="Exceptional cover"
                    value={coverId || "none"}
                    onChange={(id) => setCoverId(id === "none" ? "" : id)}
                    items={[
                      { id: "none", name: "No cover / revoke existing cover" },
                      ...config.departments
                        .filter((d) => d.id !== homeId)
                        .map((d) => ({
                          id: d.id,
                          name: `${d.branchName} · ${d.name}`,
                        })),
                    ]}
                  />
                  {coverId && (
                    <>
                      <Label htmlFor="cover-until">Cover expires</Label>
                      <Input
                        id="cover-until"
                        name="until"
                        type="datetime-local"
                        required
                      />
                    </>
                  )}
                  <Reason id="access-reason" />
                  <Button type="submit" disabled={!userId || !homeId}>
                    Save department access
                  </Button>
                </fieldset>
              </form>
            </CardContent>
          </Card>
        </>
      )}
      <ValuationPanel allowOpening />
    </div>
  )
}
function Reason({ id }: { id: string }) {
  return (
    <>
      <Label htmlFor={id}>Reason</Label>
      <Input id={id} name="reason" required minLength={3} maxLength={200} />
    </>
  )
}
export function Choice({
  id,
  label,
  value,
  onChange,
  items,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  items: { id: string; name: string }[]
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        items={items.map((item) => ({ value: item.id, label: item.name }))}
        value={value || null}
        onValueChange={(value) => onChange(value ?? "")}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={`Choose ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
