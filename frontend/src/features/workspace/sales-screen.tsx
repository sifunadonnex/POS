import {
  CreditCard,
  Minus,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"

const suggestedProducts = [
  { name: "Rice 10kg", sku: "RICE-10", price: 1250, stock: "18 left" },
  { name: "Bread loaf", sku: "BREAD-01", price: 120, stock: "42 left" },
  { name: "Milk 2L", sku: "MILK-2L", price: 210, stock: "9 left" },
  { name: "Tea leaves", sku: "TEA-250", price: 340, stock: "15 left" },
  { name: "Pasta pack", sku: "PASTA-1", price: 260, stock: "20 left" },
  { name: "Cereal mix", sku: "CEREAL-5", price: 480, stock: "6 left" },
]

const basketItems = [
  { name: "Rice 10kg", qty: 1, price: 1250, sku: "RICE-10" },
  { name: "Milk 2L", qty: 2, price: 210, sku: "MILK-2L" },
  { name: "Bread loaf", qty: 3, price: 120, sku: "BREAD-01" },
]

export function SalesScreen() {
  const subtotal = basketItems.reduce((sum, item) => sum + item.price * item.qty, 0)
  const discount = 180
  const total = subtotal - discount

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Point of sale
          </p>
          <h3 className="mt-2 text-2xl font-semibold tracking-tight">Cash register</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline">Hold cart</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700">Complete sale</Button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.7fr_0.98fr]">
        <div className="space-y-5">
          <Card className="overflow-hidden border-0 bg-background shadow-sm">
            <CardHeader className="border-b bg-muted/30 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Search className="size-4" aria-hidden="true" />
                Product lookup
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
                <Input
                  aria-label="Search products"
                  placeholder="Scan or search product"
                  className="h-11 pl-9"
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {suggestedProducts.map((product) => (
                  <Button
                    key={product.sku}
                    variant="outline"
                    className="h-auto justify-start rounded-xl border bg-white p-3 text-left shadow-none hover:bg-muted/40"
                  >
                    <div className="flex w-full flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{product.name}</p>
                          <p className="text-xs text-muted-foreground">{product.sku}</p>
                        </div>
                        <Badge variant="secondary">{product.stock}</Badge>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-base font-semibold tabular-nums">
                          KSh {product.price.toLocaleString()}
                        </span>
                        <ShoppingCart className="size-4 text-muted-foreground" aria-hidden="true" />
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 bg-background shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Recommended products</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {suggestedProducts.slice(0, 4).map((product) => (
                  <div key={product.sku} className="rounded-xl border bg-muted/20 p-3">
                    <div className="mb-3 h-20 rounded-lg bg-gradient-to-br from-slate-200 to-slate-100" />
                    <p className="font-medium">{product.name}</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-sm text-muted-foreground">{product.stock}</span>
                      <span className="font-semibold tabular-nums">KSh {product.price.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden border-0 bg-[#1f2429] text-white shadow-sm">
          <CardHeader className="border-b border-white/10 bg-[#2a2f34] pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <ShoppingCart className="size-4" aria-hidden="true" />
                Basket
              </CardTitle>
              <Badge className="border-white/15 bg-white/5 text-white">3 items</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <div className="space-y-3">
              {basketItems.map((item) => (
                <div key={item.sku} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-white">{item.name}</p>
                      <p className="text-xs text-slate-300">{item.sku}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="size-8 text-slate-200 hover:bg-white/10 hover:text-white">
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="icon" className="size-8 border-white/15 bg-transparent text-white hover:bg-white/10">
                        <Minus className="size-3.5" aria-hidden="true" />
                      </Button>
                      <span className="min-w-5 text-center font-medium text-white">{item.qty}</span>
                      <Button variant="outline" size="icon" className="size-8 border-white/15 bg-transparent text-white hover:bg-white/10">
                        <Plus className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                    <p className="font-semibold tabular-nums text-white">
                      KSh {(item.price * item.qty).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <Separator className="bg-white/10" />

            <div className="space-y-2 text-sm text-slate-300">
              <div className="flex items-center justify-between">
                <span>Subtotal</span>
                <span className="font-medium text-white tabular-nums">
                  KSh {subtotal.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Discount</span>
                <span className="font-medium text-white tabular-nums">
                  -KSh {discount.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Tax</span>
                <span className="font-medium text-white">0</span>
              </div>
            </div>

            <div className="rounded-xl bg-emerald-500/10 p-3 ring-1 ring-emerald-500/30">
              <div className="flex items-center justify-between">
                <span className="text-sm text-emerald-200">Total</span>
                <span className="text-2xl font-semibold tracking-tight text-white tabular-nums">
                  KSh {total.toLocaleString()}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">Cash</Button>
              <Button variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
                <CreditCard className="mr-2 size-4" aria-hidden="true" />
                Card
              </Button>
              <Button variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">Mpesa</Button>
              <Button variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">Voucher</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
