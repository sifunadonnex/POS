import { useRef, useState, type ChangeEvent, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  importedCount,
  previewImport,
  type ImportPreview,
} from "./catalogue-api"
import { displayPrice, errorMessage, formValue } from "./catalogue-format"
import { useCatalogueWrite } from "./use-catalogue-write"
import { WriteFeedback } from "./write-feedback"

function downloadSample() {
  const csv =
    "sku,name,category,unit,price,barcodes,tax_code\r\nRICE-LOOSE,Loose rice,,kg,180.00,0012345678905,\r\nOIL-LOOSE,Cooking oil,,l,250.00,,\r\nSOAP-PACK,Soap pack,,pack,120.00,,\r\n"
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" })
  )
  const link = document.createElement("a")
  link.href = url
  link.download = "catalogue-sample.csv"
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function CatalogueImport({
  onImported,
}: {
  onImported: (count: number) => void
}) {
  const [csv, setCsv] = useState("")
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("")
  const busy = useRef(false)
  const write = useCatalogueWrite((value) => onImported(importedCount(value)))
  const disabled = loading || write.pending || write.uncertain
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    if (busy.current || write.pending || write.uncertain) return
    const file = event.target.files?.[0]
    setCsv("")
    setPreview(null)
    setError("")
    if (!file) return
    setLoading(true)
    busy.current = true
    try {
      if (file.size > 32768 || !file.size)
        throw new Error("Choose a nonempty CSV file of at most 32 KB.")
      const content = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer()
      )
      setCsv(content)
    } catch {
      setError(
        "The file could not be read. Use a UTF-8 CSV file of at most 32 KB."
      )
    } finally {
      setLoading(false)
      busy.current = false
    }
  }
  async function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current || !csv) return
    busy.current = true
    setLoading(true)
    setError("")
    setPreview(null)
    try {
      setPreview(await previewImport(csv))
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      busy.current = false
      setLoading(false)
    }
  }
  return (
    <section className="space-y-5" aria-label="Import products">
      <div>
        <h2 className="text-xl font-semibold">Import new products</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Preview up to 100 products per file. Existing SKUs are rejected; no
          products change unless the entire file is valid.
        </p>
      </div>
      <Button variant="outline" onClick={downloadSample}>
        Download sample CSV
      </Button>
      <p className="text-sm text-muted-foreground">
        Use the sample’s columns. Categories must already exist, or leave them
        blank. Separate multiple barcodes with | and keep barcode cells as text
        in your spreadsheet.
      </p>
      <form
        onSubmit={(event) => {
          void inspect(event)
        }}
        className="space-y-3"
      >
        <Label htmlFor="catalogue-file">CSV file</Label>
        <Input
          id="catalogue-file"
          type="file"
          accept=".csv,text/csv"
          disabled={disabled}
          onChange={(event) => {
            void choose(event)
          }}
        />
        <Button type="submit" disabled={disabled || !csv}>
          {loading ? "Checking file…" : "Preview import"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {preview && (
        <>
          <p role="status">
            {preview.rows.length} products reviewed.{" "}
            {preview.canImport
              ? "Ready to import."
              : "Fix the errors and select the corrected file."}
          </p>
          <ol
            className="max-h-96 space-y-2 overflow-y-auto rounded-lg border p-3"
            aria-label="Import preview"
          >
            {preview.rows.map((row) => (
              <li
                key={row.row}
                className="space-y-1 border-b py-2 last:border-0"
              >
                <p className="text-sm font-medium break-words">
                  Row {row.row}: {row.sku} · {row.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {row.categoryName || "No category"}
                  {row.priceMinor !== null && row.unit
                    ? ` · ${displayPrice(row.priceMinor)} / ${row.unit}`
                    : ""}
                </p>
                {row.errors.map((message, index) => (
                  <p key={index} className="text-sm text-destructive">
                    {message}
                  </p>
                ))}
              </li>
            ))}
          </ol>
          {preview.canImport && (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                write.save("imports", {
                  csv,
                  reason: formValue(
                    new FormData(event.currentTarget),
                    "reason"
                  ),
                })
              }}
              className="space-y-3"
            >
              <Label htmlFor="import-reason">Reason for import</Label>
              <Input
                id="import-reason"
                name="reason"
                required
                minLength={3}
                maxLength={200}
                disabled={disabled}
              />
              <Button type="submit" disabled={disabled}>
                {write.pending
                  ? "Importing…"
                  : `Import ${preview.rows.length} products`}
              </Button>
            </form>
          )}
        </>
      )}
      <WriteFeedback {...write} />
    </section>
  )
}
