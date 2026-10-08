import { useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { errorMessage } from "../catalogue/catalogue-format"
import { getStockPosition, type StockPosition } from "./reports-api"

function quantity(
  minor: number,
  unit: StockPosition["products"][number]["unit"]
) {
  const value = unit === "kg" || unit === "l" ? minor / 1000 : minor
  return `${new Intl.NumberFormat("en-KE", { maximumFractionDigits: 3 }).format(value)} ${unit}`
}

export function StockPositionScreen() {
  const [report, setReport] = useState<StockPosition | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void getStockPosition(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setReport(result)
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(failure))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [reloadKey])

  function refresh() {
    setError("")
    setLoading(true)
    setReloadKey((value) => value + 1)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>Stock position</CardTitle>
          <CardDescription>
            Current quantities from the store with checkout and stock authority.
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={refresh}
          disabled={loading}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? <p role="status">Loading stock position…</p> : null}
        {error ? (
          <div role="alert" className="space-y-2">
            <p>{error}</p>
            <Button type="button" variant="outline" onClick={refresh}>
              Retry
            </Button>
          </div>
        ) : null}
        {report && !loading && !error ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">
                {report.source === "edge"
                  ? "Synchronized store"
                  : "Operational store"}
              </Badge>
              {report.storeId ? (
                <span className="text-muted-foreground">{report.storeId}</span>
              ) : null}
              <span className="text-muted-foreground">
                {report.products.length} product
                {report.products.length === 1 ? "" : "s"}
              </span>
            </div>
            {report.source === "edge" ? (
              <p
                role="status"
                className="rounded-lg border border-amber-500/35 bg-amber-500/5 p-3 text-sm"
              >
                {report.reportingLag.status === "current"
                  ? "Hosted events are projected. Compare the shop PC's pending-event count before treating these quantities as current."
                  : "Synchronized stock may be behind the shop PC. Reconcile pending and unprojected events before using these quantities as final."}
              </p>
            ) : null}
            {report.products.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No products in this store.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.products.map((product) => (
                    <TableRow key={product.productId}>
                      <TableCell>{product.name}</TableCell>
                      <TableCell>{product.sku}</TableCell>
                      <TableCell className="text-right">
                        {quantity(product.quantityMinor, product.unit)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
