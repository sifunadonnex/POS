import { useEffect, useState } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { formatKes, nairobiDay } from "@/lib/format"
import { businessHeaders, record, text } from "./business-api"

type DepartmentSales = {
  name: string
  branch: string
  count: number
  salesMinor: number
  refundsMinor: number
}
export function DepartmentSales() {
  const [rows, setRows] = useState<DepartmentSales[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/reports/departments/${nairobiDay()}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: businessHeaders(),
      signal: controller.signal,
    })
      .then(async (response) => {
        const value = record(await response.json())
        if (!response.ok)
          throw new Error(
            typeof value.message === "string"
              ? value.message
              : "Department sales unavailable"
          )
        if (!Array.isArray(value.departments))
          throw new Error("Invalid department sales response")
        const parsed = value.departments.map((value) => {
          const d = record(value)
          if (
            typeof d.count !== "number" ||
            typeof d.salesMinor !== "number" ||
            typeof d.refundsMinor !== "number" ||
            ![d.count, d.salesMinor, d.refundsMinor].every(Number.isSafeInteger)
          )
            throw new Error("Invalid department totals")
          return {
            name: text(d.name),
            branch: text(d.branch),
            count: d.count,
            salesMinor: d.salesMinor,
            refundsMinor: d.refundsMinor,
          }
        })
        if (!controller.signal.aborted) {
          setRows(parsed)
          setError("")
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Department sales unavailable"
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [revision])
  return (
    <Card>
      <CardHeader>
        <CardTitle>Today by department</CardTitle>
        <CardDescription>
          Completed sales and paid refunds in Nairobi time. Historical sales
          without a department stay under Unassigned history.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading department totals…
          </p>
        ) : error ? (
          <div role="alert">
            <p>{error}</p>
            <Button
              variant="outline"
              onClick={() => {
                setLoading(true)
                setRevision((n) => n + 1)
              }}
            >
              Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Configure your branches in Account settings → Business.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {rows.map((row) => (
              <div
                key={`${row.branch}:${row.name}`}
                className="rounded-lg border p-4"
              >
                <p className="text-xs text-muted-foreground">{row.branch}</p>
                <h3 className="mt-1 font-medium">{row.name}</h3>
                <p className="mt-3 text-2xl font-semibold tabular-nums">
                  {formatKes(row.salesMinor - row.refundsMinor)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.count} sales · {formatKes(row.refundsMinor)} refunded
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
