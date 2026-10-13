import { useState } from "react"
import { Package } from "lucide-react"
import type { Product } from "./catalogue-api"

export function ProductImage({
  product,
  large = false,
}: {
  product: Product
  large?: boolean
}) {
  const [failedSource, setFailedSource] = useState("")
  const src = `/api/catalogue/products/${encodeURIComponent(product.id)}/photo?v=${product.revision}`
  return (
    <div
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted/40 ${large ? "size-32" : "size-16"}`}
    >
      {product.hasImage && failedSource !== src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-contain p-1"
          onError={() => setFailedSource(src)}
        />
      ) : (
        <div
          className="flex flex-col items-center gap-1 text-muted-foreground"
          aria-label={`No photo for ${product.name}`}
        >
          <Package className={large ? "size-8" : "size-6"} aria-hidden="true" />
          {large && <span className="text-xs">Photo optional</span>}
        </div>
      )}
    </div>
  )
}
