import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  getCategories,
  getProducts,
  type Category,
  type Product,
} from "./catalogue-api"
import { displayPrice, errorMessage, formValue } from "./catalogue-format"
import { CategoryPicker } from "./category-picker"
import { ProductEditor } from "./product-editor"
import { CategoryEditor } from "./category-editor"
import { ProductHistory } from "./product-history"
import { CatalogueImport } from "./catalogue-import"

type Panel =
  | { kind: "list" | "categories" | "import" }
  | { kind: "edit"; product: Product | null }
  | { kind: "history"; product: Product }
export function CatalogueScreen({ manager }: { manager: boolean }) {
  const [products, setProducts] = useState<Product[]>([]),
    [categories, setCategories] = useState<Category[]>([])
  const [query, setQuery] = useState({
    search: "",
    categoryId: "",
    status: "active",
    page: 0,
  })
  const [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("")
  const [hasMore, setHasMore] = useState(false),
    [message, setMessage] = useState("")
  const [panel, setPanel] = useState<Panel>({ kind: "list" })
  useEffect(() => {
    let current = true
    void Promise.all([getProducts(query), getCategories()])
      .then(([result, categoryRows]) => {
        if (current) {
          setProducts(result.products)
          setHasMore(result.hasMore)
          setCategories(categoryRows)
          setError("")
        }
      })
      .catch((failure: unknown) => {
        if (current) {
          setProducts([])
          setCategories([])
          setError(errorMessage(failure))
        }
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [query, revision])
  function reload() {
    setLoading(true)
    setRevision((v) => v + 1)
  }
  function filter(values: Partial<typeof query>) {
    setLoading(true)
    setQuery((old) => ({ ...old, ...values }))
  }
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    filter({
      search: formValue(new FormData(event.currentTarget), "search").trim(),
      page: 0,
    })
  }
  function open(next: Panel) {
    setMessage("")
    setPanel(next)
  }
  return (
    <section className="space-y-5" aria-label="Product catalogue">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Product catalogue</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Find products and their current selling prices.
          </p>
        </div>
        {manager && panel.kind === "list" && (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={loading || !!error}
              onClick={() => open({ kind: "edit", product: null })}
            >
              New product
            </Button>
            <Button
              variant="outline"
              disabled={loading || !!error}
              onClick={() => open({ kind: "categories" })}
            >
              Categories
            </Button>
            <Button
              variant="outline"
              disabled={loading || !!error}
              onClick={() => open({ kind: "import" })}
            >
              Import CSV
            </Button>
          </div>
        )}
        {panel.kind !== "list" && (
          <Button
            variant="outline"
            onClick={() => {
              setPanel({ kind: "list" })
              reload()
            }}
          >
            Back to products
          </Button>
        )}
      </div>
      {message && (
        <p role="status" className="rounded-lg border bg-muted/30 p-3 text-sm">
          {message}
        </p>
      )}
      {loading ? (
        <p role="status">Loading catalogue…</p>
      ) : error ? (
        <div className="space-y-3">
          <p role="alert">{error}</p>
          <Button onClick={reload}>Retry catalogue</Button>
        </div>
      ) : manager && panel.kind === "edit" ? (
        <ProductEditor
          key={panel.product?.id ?? "new"}
          product={panel.product}
          categories={categories}
          onSaved={(product) => {
            setPanel({ kind: "list" })
            setMessage(`${product.name} saved.`)
            reload()
          }}
        />
      ) : manager && panel.kind === "categories" ? (
        <CategoryEditor
          categories={categories}
          onSaved={(category) => {
            setMessage(`Category ${category.name} saved.`)
            reload()
          }}
        />
      ) : manager && panel.kind === "import" ? (
        <CatalogueImport
          onImported={(count) => {
            setPanel({ kind: "list" })
            setMessage(`${count} products imported.`)
            reload()
          }}
        />
      ) : manager && panel.kind === "history" ? (
        <ProductHistory key={panel.product.id} product={panel.product} />
      ) : (
        <>
          <form onSubmit={search} className="flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="product-search">
                Search name, SKU or scan barcode
              </Label>
              <Input
                id="product-search"
                name="search"
                defaultValue={query.search}
                autoComplete="off"
                maxLength={160}
              />
            </div>
            <Button type="submit">Search</Button>
          </form>
          <CategoryPicker
            id="filter-category"
            categories={categories}
            value={query.categoryId}
            onChange={(categoryId) => filter({ categoryId, page: 0 })}
            emptyLabel="All categories"
          />
          {manager && (
            <div
              className="flex flex-wrap gap-2"
              aria-label="Product availability"
            >
              {["active", "archived", "all"].map((status) => (
                <Button
                  key={status}
                  variant={query.status === status ? "secondary" : "ghost"}
                  aria-pressed={query.status === status}
                  onClick={() => filter({ status, page: 0 })}
                >
                  {status === "active"
                    ? "Active"
                    : status === "archived"
                      ? "Archived"
                      : "All products"}
                </Button>
              ))}
            </div>
          )}
          {!products.length ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <h3 className="font-medium">No products found</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {query.search || query.categoryId
                  ? "Try a different search or category."
                  : manager
                    ? "Create a product or import a CSV file to start your catalogue."
                    : "A manager can add products to the catalogue."}
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {products.map((product) => (
                <li key={product.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold break-words">
                        {product.name}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {product.sku} · {product.categoryName ?? "No category"}
                        {!product.active && " · Archived"}
                      </p>
                    </div>
                    <p className="font-semibold tabular-nums">
                      {displayPrice(product.priceMinor)}{" "}
                      <span className="text-sm font-normal text-muted-foreground">
                        / {product.unit}
                      </span>
                    </p>
                  </div>
                  <p className="mt-2 text-xs break-all text-muted-foreground">
                    {product.barcodes.length
                      ? `Barcodes: ${product.barcodes.join(", ")}`
                      : "No barcode"}{" "}
                    ·{" "}
                    {product.unit === "kg" || product.unit === "l"
                      ? `Quantity step: 0.001 ${product.unit}`
                      : "Whole quantities"}
                  </p>
                  {manager && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => open({ kind: "edit", product })}
                      >
                        Edit {product.name}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => open({ kind: "history", product })}
                      >
                        History of {product.name}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="outline"
              disabled={query.page === 0}
              onClick={() => filter({ page: query.page - 1 })}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {query.page + 1}
            </span>
            <Button
              variant="outline"
              disabled={!hasMore}
              onClick={() => filter({ page: query.page + 1 })}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
