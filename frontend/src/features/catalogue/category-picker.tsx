import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Category } from "./catalogue-api"

export function CategoryPicker({
  id,
  categories,
  value,
  onChange,
  disabled = false,
  emptyLabel = "No category",
}: {
  id: string
  categories: Category[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  emptyLabel?: string
}) {
  const [search, setSearch] = useState("")
  const matches = categories.filter((category) =>
    category.name.toLowerCase().includes(search.toLowerCase())
  )
  const selected = categories.find((category) => category.id === value)
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">
        Category: {selected?.name ?? emptyLabel}
      </legend>
      <Label htmlFor={id}>Find a category</Label>
      <Input
        id={id}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Type a category name"
        maxLength={80}
        disabled={disabled}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={!value ? "secondary" : "outline"}
          aria-pressed={!value}
          disabled={disabled}
          onClick={() => onChange("")}
        >
          {emptyLabel}
        </Button>
        {matches.slice(0, 8).map((category) => (
          <Button
            key={category.id}
            type="button"
            size="sm"
            className="h-auto whitespace-normal"
            variant={value === category.id ? "secondary" : "outline"}
            aria-pressed={value === category.id}
            disabled={disabled}
            onClick={() => onChange(category.id)}
          >
            {category.name}
          </Button>
        ))}
      </div>
      {matches.length > 8 && (
        <p className="text-xs text-muted-foreground">
          Showing 8 of {matches.length}. Type more to narrow the list.
        </p>
      )}
      {!matches.length && (
        <p className="text-xs text-muted-foreground">No matching categories.</p>
      )}
    </fieldset>
  )
}
