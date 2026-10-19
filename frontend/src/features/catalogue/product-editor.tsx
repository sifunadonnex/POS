import { useState, type FormEvent, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  savedProduct,
  type Category,
  type Product,
  type SaleUnit,
} from "./catalogue-api"
import {
  formValue,
  priceText,
  stockQuantityText,
  units,
} from "./catalogue-format"
import {
  Package,
  Banknote,
  Bell,
  ImagePlus,
  type LucideIcon,
} from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCatalogueWrite } from "./use-catalogue-write"
import { WriteFeedback } from "./write-feedback"
import { ProductPhotoEditor } from "./product-photo-editor"

export function ProductEditor({
  product,
  categories,
  onSaved,
  canManagePhotos = true,
  onCancel,
}: {
  product: Product | null
  categories: Category[]
  onSaved: (product: Product) => void
  canManagePhotos?: boolean
  onCancel?: () => void
}) {
  const [unit, setUnit] = useState<SaleUnit>(product?.unit ?? "each")
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "")
  const [active, setActive] = useState(product?.active ?? true)
  const [photoBusy, setPhotoBusy] = useState(false)
  const write = useCatalogueWrite((value) => onSaved(savedProduct(value)))
  const disabled = write.pending || write.uncertain || photoBusy
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled) return
    const data = new FormData(event.currentTarget)
    write.save(
      product ? `products/${product.id}` : "products",
      {
        sku: formValue(data, "sku"),
        name: formValue(data, "name"),
        categoryId: categoryId || null,
        unit,
        price: formValue(data, "price").trim(),
        lowStockThreshold: formValue(data, "lowStockThreshold").trim() || null,
        taxCode: formValue(data, "taxCode").trim() || null,
        expiryDate: formValue(data, "expiryDate") || null,
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
      className="mx-auto max-w-6xl space-y-5"
      aria-label={product ? "Edit product" : "New product"}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">
            {product ? `Edit ${product.name}` : "New product"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {product
              ? "Update product details, pricing and stock reminders."
              : "Add the details below to make this product available in your catalogue."}
          </p>
        </div>
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            Back to products
          </Button>
        )}
      </div>
      <form onSubmit={submit} aria-busy={write.pending} className="space-y-5">
        <fieldset disabled={disabled} className="space-y-5">
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-5">
              <ProductFormSection
                icon={Package}
                title="Product details"
                description="Make this product easy to find at checkout."
              >
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
                      placeholder="e.g. MILK-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="product-name">Product name</Label>
                    <Input
                      id="product-name"
                      name="name"
                      placeholder="e.g. Fresh milk 500 ml"
                      defaultValue={product?.name ?? ""}
                      required
                      maxLength={160}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="product-category">Category (optional)</Label>
                  <Select
                    value={categoryId}
                    onValueChange={(value) => setCategoryId(value ?? "")}
                    disabled={disabled}
                    items={[
                      { value: "", label: "No category" },
                      ...categories.map((category) => ({
                        value: category.id,
                        label: category.name,
                      })),
                    ]}
                  >
                    <SelectTrigger
                      id="product-category"
                      className="h-10 w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">No category</SelectItem>
                      {categories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
              </ProductFormSection>
              <ProductFormSection
                icon={Banknote}
                title="Pricing & sales unit"
                description="Set how this product is sold and charged."
              >
                <fieldset className="space-y-2">
                  <legend className="mb-2 text-sm font-medium">
                    Sales unit
                  </legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {units.map((choice) => (
                      <Button
                        key={choice.value}
                        type="button"
                        variant="outline"
                        className={
                          unit === choice.value
                            ? "h-10 border-primary bg-primary/5 text-primary ring-1 ring-primary"
                            : "h-10"
                        }
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
                    {product &&
                      "Create a separate product to use a different unit."}
                  </p>
                </fieldset>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="product-price">
                      Selling price (KES / {unit})
                    </Label>
                    <Input
                      id="product-price"
                      className="h-11 text-lg font-medium tabular-nums"
                      name="price"
                      inputMode="decimal"
                      defaultValue={
                        product ? priceText(product.priceMinor) : ""
                      }
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
              </ProductFormSection>
            </div>
            <div className="min-w-0 space-y-5">
              <ProductFormSection
                icon={Bell}
                title="Stock reminders"
                description="Optional alerts to help you keep stock in check."
              >
                <div className="space-y-2">
                  <Label htmlFor="product-expiry">
                    Next expiry date (optional)
                  </Label>
                  <Input
                    id="product-expiry"
                    name="expiryDate"
                    type="date"
                    defaultValue={product?.expiryDate ?? ""}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use the earliest expiry on stocked units. Update after that
                    stock is removed; this reminder does not track individual
                    batches.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="product-low-stock-threshold">
                    Low-stock threshold ({unit}, optional)
                  </Label>
                  <Input
                    id="product-low-stock-threshold"
                    name="lowStockThreshold"
                    inputMode="decimal"
                    defaultValue={
                      product?.lowStockThresholdMinor === null || !product
                        ? ""
                        : stockQuantityText(
                            product.lowStockThresholdMinor,
                            unit
                          )
                    }
                    placeholder={
                      unit === "each" || unit === "pack"
                        ? "e.g. 10"
                        : "e.g. 2.500"
                    }
                    maxLength={13}
                    pattern={
                      unit === "each" || unit === "pack"
                        ? "(0|[1-9][0-9]{0,8})"
                        : "(0|[1-9][0-9]{0,8})(\\.[0-9]{1,3})?"
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    The manager dashboard alerts when available stock is at or
                    below this balance. Leave blank to disable the alert for
                    this product.
                  </p>
                </div>
              </ProductFormSection>{" "}
              {product && (
                <fieldset>
                  <legend className="mb-2 text-sm font-medium">
                    Availability
                  </legend>
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
              {!product && (
                <ProductFormSection
                  icon={ImagePlus}
                  title="Product photo"
                  description="Help staff recognise products at a glance."
                >
                  <div className="flex items-start gap-3 rounded-lg border border-dashed bg-muted/20 p-4">
                    <ImagePlus
                      className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <p className="text-sm leading-6 text-muted-foreground">
                      {canManagePhotos
                        ? "Create the product first, then open it to add a photo."
                        : "A manager can add a photo and make changes after you create this product."}
                    </p>
                  </div>
                </ProductFormSection>
              )}
            </div>
          </div>
          <div className="rounded-xl border bg-card p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="w-full sm:max-w-md">
                {" "}
                <div className="space-y-2">
                  <Label htmlFor="product-reason">Reason for change</Label>
                  <Input
                    id="product-reason"
                    name="reason"
                    placeholder={
                      product
                        ? "e.g. Updated supplier price"
                        : "e.g. New product for the shop"
                    }
                    required
                    minLength={3}
                    maxLength={200}
                  />
                </div>
              </div>
              <Button
                type="submit"
                className="w-full sm:w-auto sm:min-w-40"
                disabled={disabled}
              >
                {write.pending
                  ? "Saving…"
                  : product
                    ? "Save product"
                    : "Create product"}
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Saving updates the catalogue. Receive or adjust stock separately.
            </p>
          </div>
        </fieldset>
        <WriteFeedback {...write} />
      </form>
      {product && canManagePhotos && (
        <ProductPhotoEditor
          product={product}
          onSaved={onSaved}
          blocked={write.pending || write.uncertain}
          onBusy={setPhotoBusy}
        />
      )}
    </section>
  )
}

function ProductFormSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex items-start gap-3 border-b bg-muted/20 py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 py-5">{children}</CardContent>
    </Card>
  )
}
