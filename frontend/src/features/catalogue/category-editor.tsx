import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { savedCategory, type Category } from "./catalogue-api"
import { formValue } from "./catalogue-format"
import { useCatalogueWrite } from "./use-catalogue-write"
import { WriteFeedback } from "./write-feedback"

function CategoryForm({
  category,
  onSaved,
}: {
  category: Category | null
  onSaved: (category: Category) => void
}) {
  const write = useCatalogueWrite((value) => onSaved(savedCategory(value)))
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    write.save(
      category ? `categories/${category.id}` : "categories",
      {
        name: formValue(data, "name"),
        reason: formValue(data, "reason"),
        ...(category ? { revision: category.revision } : {}),
      },
      category ? "PATCH" : "POST"
    )
  }
  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-lg border p-4"
      aria-label={category ? "Rename category" : "New category"}
    >
      <h3 className="font-medium">
        {category ? `Rename ${category.name}` : "New category"}
      </h3>
      <fieldset
        className="space-y-4"
        disabled={write.pending || write.uncertain}
      >
        <div className="space-y-2">
          <Label htmlFor="category-name">Category name</Label>
          <Input
            id="category-name"
            name="name"
            required
            maxLength={80}
            defaultValue={category?.name ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="category-reason">Reason for change</Label>
          <Input
            id="category-reason"
            name="reason"
            required
            minLength={3}
            maxLength={200}
          />
        </div>
        <Button type="submit" disabled={write.pending || write.uncertain}>
          {write.pending ? "Saving…" : "Save category"}
        </Button>
      </fieldset>
      <WriteFeedback {...write} />
    </form>
  )
}
export function CategoryEditor({
  categories,
  onSaved,
}: {
  categories: Category[]
  onSaved: (category: Category) => void
}) {
  const [selected, setSelected] = useState<Category | null>(null)
  const [search, setSearch] = useState("")
  const [formRevision, setFormRevision] = useState(0)
  const matching = categories.filter((category) =>
    category.name.toLowerCase().includes(search.toLowerCase())
  )
  return (
    <section className="space-y-5" aria-label="Categories">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Categories</h2>
        <Button
          variant="outline"
          onClick={() => {
            setSelected(null)
            setFormRevision((v) => v + 1)
          }}
        >
          New category
        </Button>
      </div>
      <CategoryForm
        key={`${selected?.id ?? "new"}-${formRevision}`}
        category={selected}
        onSaved={(category) => {
          setSelected(null)
          setFormRevision((v) => v + 1)
          onSaved(category)
        }}
      />
      <div className="space-y-2">
        <Label htmlFor="category-search">Search categories</Label>
        <Input
          id="category-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          maxLength={80}
        />
      </div>
      <ul className="space-y-2">
        {matching.slice(0, 25).map((category) => (
          <li
            key={category.id}
            className="flex items-center justify-between gap-3 rounded-lg border p-3"
          >
            <span className="min-w-0 break-words">{category.name}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelected(category)
                setFormRevision((v) => v + 1)
              }}
            >
              Rename {category.name}
            </Button>
          </li>
        ))}
      </ul>
      {!matching.length && (
        <p className="text-sm text-muted-foreground">No matching categories.</p>
      )}
      {matching.length > 25 && (
        <p className="text-sm text-muted-foreground">
          Showing 25 of {matching.length}. Narrow your search to find another
          category.
        </p>
      )}
    </section>
  )
}
