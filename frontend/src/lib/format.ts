const nairobiDateTime = new Intl.DateTimeFormat("en-KE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Nairobi",
})

export function formatKes(value: number | string | bigint) {
  const amount = BigInt(value)
  const negative = amount < 0n
  const absolute = negative ? -amount : amount
  const whole = (absolute / 100n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  const fraction = (absolute % 100n).toString().padStart(2, "0")
  return `${negative ? "-" : ""}KES ${whole}.${fraction}`
}

export function formatNairobiDateTime(value: string | Date) {
  return nairobiDateTime.format(
    typeof value === "string" ? new Date(value) : value
  )
}
