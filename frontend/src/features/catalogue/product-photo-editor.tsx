import { useEffect, useState, type FormEvent } from "react"
import { ImagePlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { savedProduct, type Product } from "./catalogue-api"
import { ProductImage } from "./product-image"
import { useCatalogueWrite } from "./use-catalogue-write"
import { WriteFeedback } from "./write-feedback"

export function ProductPhotoEditor({
  product,
  onSaved,
  blocked = false,
  onBusy,
}: {
  product: Product
  onSaved: (product: Product) => void
  blocked?: boolean
  onBusy?: (busy: boolean) => void
}) {
  const [photo, setPhoto] = useState<{ data: string; preview: string } | null>(
    null
  )
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState("")
  const write = useCatalogueWrite((value) => onSaved(savedProduct(value)))
  const busy = preparing || write.pending || write.uncertain
  const disabled = busy || blocked
  useEffect(() => {
    onBusy?.(busy)
  }, [busy, onBusy])
  async function select(file?: File) {
    if (!file) return
    setError("")
    setPhoto(null)
    setPreparing(true)
    try {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 10 * 1024 * 1024
      )
        throw new Error("Choose a PNG, JPEG or WebP image up to 10 MB.")
      const image = await createImageBitmap(file)
      const canvas = document.createElement("canvas")
      const scale = Math.min(1, 1024 / Math.max(image.width, image.height))
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      const context = canvas.getContext("2d")
      if (!context) {
        image.close()
        throw new Error("Image preparation is unavailable in this browser.")
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      image.close()
      const preview = canvas.toDataURL("image/webp", 0.82)
      const data = preview.split(",")[1]
      if (!data || data.length > 699052)
        throw new Error(
          "This photo is still too large. Choose a simpler or smaller image."
        )
      setPhoto({ data, preview })
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The image could not be prepared. Try another file."
      )
    } finally {
      setPreparing(false)
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled) return
    const submitter =
      event.nativeEvent instanceof SubmitEvent
        ? event.nativeEvent.submitter
        : null
    const removing =
      submitter instanceof HTMLButtonElement && submitter.value === "remove"
    if (!removing && !photo) return
    const reason = new FormData(event.currentTarget).get("photo-reason")
    write.save(`products/${product.id}/photo`, {
      revision: product.revision,
      reason,
      photo: removing ? null : { data: photo?.data },
    })
  }
  return (
    <section
      className="rounded-2xl border bg-card p-5 sm:p-6"
      aria-label="Product photo"
    >
      <h3 className="flex items-center gap-2 font-semibold">
        <ImagePlus className="size-4" aria-hidden="true" />
        Product photo{" "}
        <span className="text-xs font-normal text-muted-foreground">
          Optional
        </span>
      </h3>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        Photos help identify products. Prices and product details remain easy to
        read without one.
      </p>
      <form className="mt-5 space-y-4" onSubmit={submit} aria-busy={disabled}>
        <div className="flex flex-wrap items-center gap-5">
          {photo ? (
            <img
              alt="Selected product photo preview"
              src={photo.preview}
              className="size-32 rounded-xl border bg-muted/40 object-contain p-2"
            />
          ) : (
            <ProductImage product={product} large />
          )}
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="product-photo">Choose photo</Label>
            <Input
              id="product-photo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={disabled}
              onChange={(event) => void select(event.target.files?.[0])}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              PNG, JPEG or WebP, up to 10 MB. Resized to 1024 pixels and stored
              up to 512 KB. Offline shop copies currently show the product icon.
            </p>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="photo-reason">Reason for photo change</Label>
          <Input
            id="photo-reason"
            name="photo-reason"
            required
            minLength={3}
            maxLength={200}
            disabled={disabled}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={disabled || !photo}>
            {preparing
              ? "Preparing photo…"
              : write.pending
                ? "Saving…"
                : "Save photo"}
          </Button>
          {product.hasImage && (
            <Button
              type="submit"
              name="intent"
              value="remove"
              variant="outline"
              disabled={disabled}
            >
              Remove photo
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <WriteFeedback {...write} />
      </form>
    </section>
  )
}
