import { useEffect, useState } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { businessHeaders, record, text } from "./business-api"

type Expiry = {
  productId: string
  name: string
  sku: string
  departmentLabel: string
  expiryDate: string
  daysRemaining: number
}
export function ExpiryAlerts() {
  const [items, setItems] = useState<Expiry[]>([])
  const [days, setDays] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [count, setCount] = useState(0)
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/reports/expiry", {
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
              : "Expiry alerts unavailable"
          )
        if (
          !Array.isArray(value.items) ||
          typeof value.count !== "number" ||
          (value.warningDays !== null && typeof value.warningDays !== "number")
        )
          throw new Error("Invalid expiry response")
        const parsed = value.items.map((value) => {
          const item = record(value)
          if (typeof item.daysRemaining !== "number")
            throw new Error("Invalid expiry response")
          return {
            productId: text(item.productId),
            name: text(item.name),
            sku: text(item.sku),
            departmentLabel: text(item.departmentLabel),
            expiryDate: text(item.expiryDate),
            daysRemaining: item.daysRemaining,
          }
        })
        if (!controller.signal.aborted) {
          setItems(parsed)
          setDays(value.warningDays)
          setCount(value.count)
          setError("")
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Expiry alerts unavailable"
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
        <CardTitle>
          Expiry watch{" "}
          {count > 0 && <Badge variant="destructive">{count}</Badge>}
        </CardTitle>
        <CardDescription>
          {days === null
            ? "Set the warning period in Account settings → Business. Expired stock is still shown."
            : `Stock expiring within ${days} days, including expired products.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Checking expiry dates…
          </p>
        ) : error ? (
          <div role="alert" className="space-y-2">
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
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No stocked products require expiry attention.
          </p>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li
                key={item.productId}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.sku} · {item.expiryDate} · {item.departmentLabel}
                  </p>
                </div>
                <Badge
                  variant={item.daysRemaining < 0 ? "destructive" : "secondary"}
                >
                  {item.daysRemaining < 0
                    ? `Expired ${-item.daysRemaining} days ago`
                    : item.daysRemaining === 0
                      ? "Expires today"
                      : `${item.daysRemaining} days left`}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {count > items.length && (
          <p className="mt-3 text-xs text-muted-foreground">
            Showing the earliest {items.length} of {count}; review expiry dates
            in the catalogue.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
