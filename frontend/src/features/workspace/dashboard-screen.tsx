import {
  ArrowDownRight,
  ArrowUpRight,
  CircleDollarSign,
  PackageSearch,
  Search,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const overview = [
  {
    title: "Sales today",
    value: "KSh 48,200",
    delta: "+12.4%",
    direction: "up",
    icon: CircleDollarSign,
  },
  {
    title: "Transactions",
    value: "184",
    delta: "+24",
    direction: "up",
    icon: ShoppingCart,
  },
  {
    title: "Refunds",
    value: "KSh 1,260",
    delta: "-3.8%",
    direction: "down",
    icon: ArrowDownRight,
  },
  {
    title: "Low stock",
    value: "6 items",
    delta: "2 urgent",
    direction: "up",
    icon: PackageSearch,
  },
]

const salesByHour = [
  { label: "09:00", value: 24 },
  { label: "10:00", value: 46 },
  { label: "11:00", value: 58 },
  { label: "12:00", value: 68 },
  { label: "13:00", value: 74 },
  { label: "14:00", value: 63 },
  { label: "15:00", value: 82 },
  { label: "16:00", value: 38 },
]

const recentSales = [
  { id: "#1048", customer: "Walk-in", item: "Bread loaf", amount: "KSh 1,200", time: "09:14" },
  { id: "#1049", customer: "M. Kamau", item: "Milk 2L", amount: "KSh 890", time: "09:32" },
  { id: "#1050", customer: "L. Wanjiku", item: "Pasta pack", amount: "KSh 540", time: "09:45" },
  { id: "#1051", customer: "Walk-in", item: "Tea leaves", amount: "KSh 620", time: "10:02" },
  { id: "#1052", customer: "A. Otieno", item: "Rice 10kg", amount: "KSh 2,350", time: "10:18" },
]

const lowStock = [
  { item: "Whole milk", qty: "2 cartons", status: "Reorder soon" },
  { item: "Bread loaf", qty: "5 left", status: "Low" },
  { item: "Cereal mix", qty: "3 boxes", status: "Critical" },
]

export function DashboardScreen() {
  return (
    <div className="space-y-6 pt-2">
      <header className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Store overview
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">
              Sales dashboard
            </h2>
          </div>

          <div className="flex w-full max-w-xl items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
              <Input
                aria-label="Search products or orders"
                placeholder="Search products, SKU or orders"
                className="pl-9"
              />
            </div>
            <Button variant="outline">Download</Button>
            <Button>New sale</Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm">Receive stock</Button>
          <Button variant="outline" size="sm">Stock count</Button>
          <Button variant="outline" size="sm">Open shift</Button>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {overview.map(({ title, value, delta, direction, icon: Icon }) => (
          <Card key={title}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="rounded-md bg-muted p-2">
                  <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                </div>
                <Badge variant={direction === "up" ? "secondary" : "outline"}>
                  {direction === "up" ? (
                    <ArrowUpRight className="mr-1 size-3" aria-hidden="true" />
                  ) : (
                    <ArrowDownRight className="mr-1 size-3" aria-hidden="true" />
                  )}
                  {delta}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{title}</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle>Traffic and sales</CardTitle>
                <CardDescription>Hourly activity across your store</CardDescription>
              </div>
              <Badge variant="secondary">Live</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex h-52 items-end gap-3 px-2 pt-4">
              {salesByHour.map(({ label, value }) => (
                <div key={label} className="flex flex-1 flex-col items-center gap-2">
                  <div
                    className="w-full rounded-t-md bg-primary/85"
                    style={{ height: `${value}%`, minHeight: 20 }}
                    aria-label={`${label} sales ${value}%`}
                  />
                  <span className="text-[10px] text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Shift summary</CardTitle>
            <CardDescription>Cash and till health</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg bg-muted/70 p-3">
              <div>
                <p className="text-sm text-muted-foreground">Opened</p>
                <p className="text-lg font-semibold">08:30 AM</p>
              </div>
              <Badge>Shift open</Badge>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Cash in drawer</span>
                <span className="font-medium">KSh 16,400</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Expected cash</span>
                <span className="font-medium">KSh 17,080</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Variance</span>
                <span className="font-medium text-emerald-600">+KSh 680</span>
              </div>
            </div>
            <Button className="w-full" variant="outline">
              <Wallet className="mr-2 size-4" aria-hidden="true" />
              Close shift
            </Button>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Recent sales</CardTitle>
            <CardDescription>Latest transactions on the till</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentSales.map((sale) => (
                  <TableRow key={sale.id}>
                    <TableCell className="font-medium">{sale.id}</TableCell>
                    <TableCell>{sale.customer}</TableCell>
                    <TableCell>{sale.item}</TableCell>
                    <TableCell className="text-right font-medium">{sale.amount}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{sale.time}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle>Low stock</CardTitle>
              <Badge variant="destructive">Needs review</Badge>
            </div>
            <CardDescription>Items requiring replenishment</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {lowStock.map((item) => (
              <div key={item.item} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{item.item}</p>
                  <Badge
                    variant={
                      item.status === "Critical"
                        ? "destructive"
                        : item.status === "Reorder soon"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {item.status}
                  </Badge>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
                  <span>Available</span>
                  <span className="font-medium text-foreground">{item.qty}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle>Today’s performance</CardTitle>
              <CardDescription>Revenue trend versus the current target</CardDescription>
            </div>
            <div className="flex items-center gap-2 text-emerald-600">
              <TrendingUp className="size-4" aria-hidden="true" />
              <span className="text-sm font-medium">Target +8.2%</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 rounded-xl bg-muted/50 p-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Gross sales</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight">KSh 48,200</p>
            </div>
            <Separator orientation="vertical" className="hidden h-12 md:block" />
            <div>
              <p className="text-sm text-muted-foreground">Average basket</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">KSh 640</p>
            </div>
            <Separator orientation="vertical" className="hidden h-12 md:block" />
            <div>
              <p className="text-sm text-muted-foreground">Best seller</p>
              <p className="mt-2 text-xl font-semibold tracking-tight">Rice 10kg</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
