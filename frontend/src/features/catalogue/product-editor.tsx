import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  savedProduct,
  type Category,
  type Product,
  type SaleUnit,
} from "./catalogue-api"
import { formValue, priceText, units } from "./catalogue-format"
import { CategoryPicker } from "./category-picker"
import { useCatalogueWrite } from "./use-catalogue-write"
import { WriteFeedback } from "./write-feedback"

export function ProductEditor({
  product,
  categories,
  onSaved,
}: {
  product: Product | null
  categories: Category[]
  onSaved: (product: Product) => void
}) {
  const [unit, setUnit] = useState<SaleUnit>(product?.unit ?? "each")
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "")
  const [active, setActive] = useState(product?.active ?? true)
  const write = useCatalogueWrite((value) => onSaved(savedProduct(value)))
  const disabled = write.pending || write.uncertain
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    write.save(
      product ? `products/${product.id}` : "products",
      {
        sku: formValue(data, "sku"),
        name: formValue(data, "name"),
        categoryId: categoryId || null,
        unit,
        price: formValue(data, "price").trim(),
        taxCode: formValue(data, "taxCode").trim() || null,
        barcodes: formValue(data, "barcodes")
          .split(",")
          .map((code) => code.trim())
          .filter(Boolean),
        active,
        reason: formValue(data, "reason"),
        ...(product ? { revision: product.revision } : {}),
      },
      product ? "PATCH" : "POST"
    )
  }
  return (
    <section
      className="space-y-4"
      aria-label={product ? "Edit product" : "New product"}
    >
      <div>
        <h2 className="text-xl font-semibold">
          {product ? `Edit ${product.name}` : "New product"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Set the selling unit and price. Catalogue changes do not change stock.
        </p>
      </div>
      <form onSubmit={submit} aria-busy={write.pending} className="space-y-5">
        <fieldset disabled={disabled} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="product-sku">SKU / product code</Label>
              <Input
                id="product-sku"
                name="sku"
                defaultValue={product?.sku ?? ""}
                required
                maxLength={40}
                pattern="[A-Za-z0-9][A-Za-z0-9._\-]*"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-name">Product name</Label>
              <Input
                id="product-name"
                name="name"
                defaultValue={product?.name ?? ""}
                required
                maxLength={160}
              />
            </div>
          </div>
          <CategoryPicker
            id="product-category"
            categories={categories}
            value={categoryId}
            onChange={setCategoryId}
            disabled={disabled}
          />
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Sales unit</legend>
            <div className="flex flex-wrap gap-2">
              {units.map((choice) => (
                <Button
                  key={choice.value}
                  type="button"
                  variant={unit === choice.value ? "secondary" : "outline"}
                  aria-pressed={unit === choice.value}
                  disabled={!!product || disabled}
                  onClick={() => setUnit(choice.value)}
                >
                  {choice.label}
                </Button>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              {units.find((choice) => choice.value === unit)?.help}.{" "}
              {product && "Create a separate product to use a different unit."}
            </p>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="product-price">
                Selling price (KES / {unit})
              </Label>
              <Input
                id="product-price"
                name="price"
                inputMode="decimal"
                defaultValue={product ? priceText(product.priceMinor) : ""}
                placeholder="0.00"
                required
                maxLength={10}
                pattern="(0|[1-9][0-9]{0,6})(\.[0-9]{1,2})?"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-tax">
                Tax classification code (optional)
              </Label>
              <Input
                id="product-tax"
                name="taxCode"
                defaultValue={product?.taxCode ?? ""}
                maxLength={40}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-barcodes">Barcodes (optional)</Label>
            <Input
              id="product-barcodes"
              name="barcodes"
              defaultValue={product?.barcodes.join(", ") ?? ""}
              maxLength={330}
              autoComplete="off"
              placeholder="0012345678905, another-code"
            />
            <p className="text-xs text-muted-foreground">
              Separate up to five codes with commas. Leading zeros are
              preserved.
            </p>
          </div>
          {product && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Availability</legend>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={active ? "secondary" : "outline"}
                  aria-pressed={active}
                  disabled={disabled}
                  onClick={() => setActive(true)}
                >
                  Active
                </Button>
                <Button
                  type="button"
                  variant={!active ? "secondary" : "outline"}
                  aria-pressed={!active}
                  disabled={disabled}
                  onClick={() => setActive(false)}
                >
                  Archived
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Archived products are hidden from cashier searches. Their
                history stays available.
              </p>
            </fieldset>
          )}
          <div className="space-y-2">
            <Label htmlFor="product-reason">Reason for change</Label>
            <Input
              id="product-reason"
              name="reason"
              required
              minLength={3}
              maxLength={200}
            />
          </div>
          <Button type="submit" disabled={disabled}>
            {write.pending
              ? "Saving…"
              : product
                ? "Save product"
                : "Create product"}
          </Button>
        </fieldset>
        <WriteFeedback {...write} />
      </form>
    </section>
  )
}
