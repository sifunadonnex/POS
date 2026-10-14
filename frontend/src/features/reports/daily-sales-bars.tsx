import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { formatKes } from "@/lib/format"
import type { SalesInsights } from "./reports-api"

type SalesDay = SalesInsights["daily"][number]
const chartConfig = {
  grossSalesMinor: { label: "Gross sales", color: "var(--chart-1)" },
  refundMinor: { label: "Refunds", color: "var(--chart-2)" },
} satisfies ChartConfig

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
  return (
    <figure aria-label="Daily gross sales and refunds">
      <div className="mb-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-chart-1" /> Gross sales
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-chart-2" /> Refunds
        </span>
        <span className="ml-auto">KES</span>
      </div>
      <ChartContainer
        config={chartConfig}
        className={`aspect-auto w-full ${compact ? "h-48" : "h-64"}`}
      >
        <BarChart
          accessibilityLayer
          data={daily}
          margin={{ top: 8, right: 8, left: 0 }}
        >
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="day"
            tickFormatter={shortDay}
            tickLine={false}
            axisLine={false}
            tickMargin={10}
            minTickGap={32}
          />
          <YAxis
            tickFormatter={(minor: number) =>
              new Intl.NumberFormat("en-KE", {
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(minor / 100)
            }
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(value) =>
                  typeof value === "string" ? shortDay(value) : value
                }
                formatter={(value, name) => (
                  <div className="flex w-full items-center justify-between gap-6">
                    <span className="text-muted-foreground">
                      {name === "grossSalesMinor" ? "Gross sales" : "Refunds"}
                    </span>
                    <span className="font-medium tabular-nums">
                      {typeof value === "number" ? formatKes(value) : "—"}
                    </span>
                  </div>
                )}
              />
            }
          />
          <Bar
            dataKey="grossSalesMinor"
            fill="var(--color-grossSalesMinor)"
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
            isAnimationActive={false}
          />
          <Bar
            dataKey="refundMinor"
            fill="var(--color-refundMinor)"
            radius={[4, 4, 0, 0]}
            maxBarSize={18}
            isAnimationActive={false}
          />
        </BarChart>
      </ChartContainer>
      <ul className="sr-only">
        {daily.map((day) => (
          <li key={day.day}>
            {day.day}: {formatKes(day.grossSalesMinor)} gross sales from{" "}
            {day.saleCount} sales, {formatKes(day.refundMinor)} refunded
          </li>
        ))}
      </ul>
    </figure>
  )
}
