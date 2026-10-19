import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Choice } from "./business-settings"
import {
  getBusinessConfiguration,
  type BusinessConfiguration,
} from "./business-api"

export function BusinessSelector({
  userId,
  manager,
  onChange,
  open,
  onOpenChange,
}: {
  userId: string
  manager: boolean
  onChange: (key: string) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [configuration, setConfiguration] =
    useState<BusinessConfiguration | null>(null)
  const [department, setDepartment] = useState(
    sessionStorage.getItem("paygo-department") ?? ""
  )
  const [till, setTill] = useState(sessionStorage.getItem("paygo-till") ?? "")
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const changed = () => setRevision((n) => n + 1)
    window.addEventListener("paygo-business-changed", changed)
    return () => window.removeEventListener("paygo-business-changed", changed)
  }, [])
  useEffect(() => {
    let current = true
    void getBusinessConfiguration()
      .then((config) => {
        if (!current) return
        const saved =
          sessionStorage.getItem("paygo-scope-user") === userId
            ? sessionStorage.getItem("paygo-department")
            : null
        const selected =
          config.departments.find((d) => d.id === saved)?.id ??
          (manager ? "" : (config.departments.find((d) => d.home)?.id ?? ""))
        const savedTill = sessionStorage.getItem("paygo-till")
        const selectedTill =
          config.tills.find(
            (t) => t.id === savedTill && t.departmentId === selected
          )?.id ?? ""
        sessionStorage.setItem("paygo-scope-user", userId)
        sessionStorage.setItem("paygo-department", selected)
        sessionStorage.setItem("paygo-till", selectedTill)
        setDepartment(selected)
        setTill(selectedTill)
        setConfiguration(config)
        setError("")
        onChange(`${selected}:${selectedTill}`)
      })
      .catch((failure: unknown) => {
        if (current)
          setError(
            failure instanceof Error ? failure.message : "Workspace unavailable"
          )
      })
    return () => {
      current = false
    }
  }, [userId, manager, revision, onChange])
  function select(departmentId: string, tillId: string) {
    if (localStorage.getItem("paygo-external-payment")) {
      setError("Resolve the pending payment before changing workspace.")
      return
    }
    sessionStorage.setItem("paygo-department", departmentId)
    sessionStorage.setItem("paygo-till", tillId)
    setDepartment(departmentId)
    setTill(tillId)
    setError("")
    onChange(`${departmentId}:${tillId}:${revision}`)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" className="max-w-36 truncate sm:max-w-64" />
        }
      >
        {configuration?.departments
          .filter((d) => d.id === department)
          .map((d) => `${d.branchName} · ${d.name}`)[0] ??
          (manager ? "All departments" : "Choose workspace")}
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Branch, department & till</DialogTitle>
        <DialogDescription>
          Select the workspace for this register. Access is checked by the
          server. Saved baskets stay in their original department.
        </DialogDescription>
        <div className="space-y-2">
          {configuration && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Choice
                id="workspace-department"
                label="Branch / department"
                value={department || "combined"}
                onChange={(value) =>
                  select(value === "combined" ? "" : value, "")
                }
                items={[
                  ...(manager
                    ? [{ id: "combined", name: "Combined business overview" }]
                    : []),
                  ...configuration.departments.map((d) => ({
                    id: d.id,
                    name: `${d.branchName} · ${d.name}`,
                  })),
                ]}
              />
              {department && (
                <Choice
                  id="workspace-till"
                  label="Till"
                  value={till}
                  onChange={(value) => select(department, value)}
                  items={configuration.tills
                    .filter((t) => t.departmentId === department)
                    .map((t) => ({ id: t.id, name: t.name }))}
                />
              )}
            </div>
          )}
          {configuration?.departments.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {manager
                ? "Configure branches in Account settings → Business."
                : "Ask a manager to assign your home department."}
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}{" "}
              <Button
                variant="link"
                size="sm"
                onClick={() => setRevision((n) => n + 1)}
              >
                Retry
              </Button>
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
