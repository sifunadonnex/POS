import type { SaleUnit } from "./catalogue-api"

export const units: { value: SaleUnit; label: string; help: string }[] = [
  { value: "each", label: "Item", help: "Sold in whole items" },
  {
    value: "pack",
    label: "Pack",
    help: "Sold in whole packs; no automatic pack conversion",
  },
  {
    value: "kg",
    label: "Kilogram",
    help: "Price per kilogram; quantities in steps of 0.001 kg (1 g)",
  },
  {
    value: "l",
    label: "Litre",
    help: "Price per litre; quantities in steps of 0.001 l (1 ml)",
  },
]
export function priceText(minor: string): string {
  const amount = BigInt(minor)
  return `${amount / 100n}.${(amount % 100n).toString().padStart(2, "0")}`
}
export function displayPrice(minor: string): string {
  const [whole, fraction] = priceText(minor).split(".")
  return `KES ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`
}
export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The request failed. Please retry."
}
export function formValue(data: FormData, name: string): string {
  const value = data.get(name)
  return typeof value === "string" ? value : ""
}
