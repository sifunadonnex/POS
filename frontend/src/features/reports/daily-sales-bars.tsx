import type { SalesInsights } from "./reports-api"
import { formatKes } from "@/lib/format"

type SalesDay = SalesInsights["daily"][number]

function money(minor: number) {
  return formatKes(minor)
}

function shortDay(value: string) {
  return new Intl.DateTimeFormat("en-KE", {
    day: "numeric",
    month: "short",
  }).format(new Date(`${value}T00:00:00`))
}

export function DailySalesBars({
  daily,
  compact = false,
}: {
  daily: SalesDay[]
  compact?: boolean
}) {
  if (daily.length === 0) {
    return (
      <div className="flex min-h-36 items-center justify-center rounded-xl border border-dashed bg-muted/20 p-5 text-center text-sm text-muted-foreground">
        No sales activity in this period.
      </div>
    )
  }

  const maximum = Math.max(
    1,
    ...daily.flatMap((day) => [day.grossSalesMinor, day.refundMinor])
  )
  const anchorIndexes = Array.from(
    new Set([0, Math.floor((daily.length - 1) / 2), daily.length - 1])
  )

  return (
    <figure>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex flex-wrap gap-4">
          <span className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-primary" /> Gross sales
          </span>
          <span className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-amber-500" /> Refunds
          </span>
        </div>
        <span className="tabular-nums">Scale {money(maximum)}</span>
      </div>

      <div className="relative border-b">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border/70"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-border/70"
          aria-hidden="true"
        />
        <div
          className={`grid items-end gap-px px-1 sm:gap-1 ${compact ? "h-36" : "h-48"}`}
          style={{
            gridTemplateColumns: `repeat(${daily.length}, minmax(0, 1fr))`,
          }}
          aria-hidden="true"
        >
          {daily.map((day) => {
            const grossHeight = Math.round(
              (day.grossSalesMinor / maximum) * 100
            )
            const refundHeight = Math.round((day.refundMinor / maximum) * 100)
            return (
              <div
                key={day.day}
                className="flex h-full min-w-0 items-end justify-center gap-px"
                title={`${shortDay(day.day)}: ${money(day.grossSalesMinor)} gross, ${money(day.refundMinor)} refunded`}
              >
                <div
                  className="w-[55%] max-w-4 rounded-t-sm bg-primary transition-[height]"
                  style={{
                    height: `${day.grossSalesMinor ? Math.max(grossHeight, 2) : 0}%`,
                  }}
                />
                <div
                  className="w-[30%] max-w-2 rounded-t-sm bg-amber-500 transition-[height]"
                  style={{
                    height: `${day.refundMinor ? Math.max(refundHeight, 2) : 0}%`,
                  }}
                />
              </div>
            )
          })}
        </div>
      </div>

      <div className="relative mt-2 h-4 text-[10px] text-muted-foreground">
        {anchorIndexes.map((index, position) => (
          <span
            key={daily[index].day}
            className={`absolute tabular-nums ${
              position === 0
                ? "left-0"
                : position === anchorIndexes.length - 1
                  ? "right-0"
                  : "left-1/2 -translate-x-1/2"
            }`}
          >
            {shortDay(daily[index].day)}
          </span>
        ))}
      </div>

      <ul className="sr-only">
        {daily.map((day) => (
          <li key={day.day}>
            {day.day}: {money(day.grossSalesMinor)} gross sales from{" "}
            {day.saleCount} sales, {money(day.refundMinor)} refunded
          </li>
        ))}
      </ul>
    </figure>
  )
}
