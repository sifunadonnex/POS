import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { getHistory, type HistoryEntry, type Product } from "./catalogue-api"
import { displayPrice, errorMessage } from "./catalogue-format"

export function ProductHistory({ product }: { product: Product }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [page, setPage] = useState(0),
    [revision, setRevision] = useState(0)
  const [hasMore, setHasMore] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("")
  useEffect(() => {
    let current = true
    void getHistory(product.id, page)
      .then((result) => {
        if (current) {
          setEntries(result.history)
          setHasMore(result.hasMore)
          setError("")
        }
      })
      .catch((failure: unknown) => {
        if (current) {
          setEntries([])
          setError(errorMessage(failure))
        }
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [product.id, page, revision])
  return (
    <section className="space-y-4" aria-label="Product history">
      <h2 className="text-xl font-semibold">History: {product.name}</h2>
      <p className="text-sm text-muted-foreground">
        Saved versions retain the price and product details from each change.
      </p>
      {loading ? (
        <p role="status">Loading history…</p>
      ) : error ? (
        <div className="space-y-2">
          <p role="alert">{error}</p>
          <Button
            onClick={() => {
              setLoading(true)
              setRevision((v) => v + 1)
            }}
          >
            Retry
          </Button>
        </div>
      ) : entries.length ? (
        <ol className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="space-y-2 rounded-lg border p-4">
              <p className="font-medium">
                Version {entry.revision} ·{" "}
                {displayPrice(entry.snapshot.priceMinor)} /{" "}
                {entry.snapshot.unit}
              </p>
              <p className="text-sm">
                {entry.snapshot.name} · {entry.snapshot.sku} ·{" "}
                {entry.snapshot.active ? "Active" : "Archived"}
              </p>
              <p className="text-sm text-muted-foreground">
                {entry.snapshot.categoryName ?? "No category"} · Tax code:{" "}
                {entry.snapshot.taxCode ?? "Not set"}
              </p>
              <p className="text-sm break-all">
                Barcodes: {entry.snapshot.barcodes.join(", ") || "None"}
              </p>
              <p className="text-sm">{entry.reason}</p>
              <p className="text-xs text-muted-foreground">
                {entry.actorName} ·{" "}
                {new Date(entry.createdAt).toLocaleString("en-KE", {
                  timeZone: "Africa/Nairobi",
                })}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p>No product history found.</p>
      )}
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="outline"
          disabled={loading || page === 0}
          onClick={() => {
            setLoading(true)
            setPage((v) => v - 1)
          }}
        >
          Previous
        </Button>
        <span className="text-sm">Page {page + 1}</span>
        <Button
          variant="outline"
          disabled={loading || !hasMore}
          onClick={() => {
            setLoading(true)
            setPage((v) => v + 1)
          }}
        >
          Next
        </Button>
      </div>
    </section>
  )
}
