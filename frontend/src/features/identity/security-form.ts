export function formText(data: FormData, name: string): string {
  const value = data.get(name)
  return typeof value === "string" ? value : ""
}

export function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The request could not be completed. Please retry."
}
