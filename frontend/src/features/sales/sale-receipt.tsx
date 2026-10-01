import type { SaleUnit } from "../catalogue/catalogue-api"
import { displayPrice } from "../catalogue/catalogue-format"
import { formatNairobiDateTime } from "@/lib/format"
import type { SaleReceipt } from "./sales-api"

const paymentNames: Record<SaleReceipt["payments"][number]["kind"], string> = {
  cash: "Cash",
  card: "Card",
  mpesa: "M-Pesa",
}

function money(value: number) {
  return displayPrice(String(value))
}

function quantity(value: number, unit: SaleUnit) {
  const formatted =
    unit === "each" || unit === "pack"
      ? String(value)
      : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
  return `${formatted} ${unit}`
}

function lineLabel(count: number) {
  return `${count} item line${count === 1 ? "" : "s"}`
}

type SaleReceiptViewProps = {
  receipt: SaleReceipt
}

export function SaleReceiptView({ receipt }: SaleReceiptViewProps) {
  return (
    <article
      aria-label="Printable receipt"
      data-print-receipt
      className="receipt-paper mx-auto w-full max-w-[21rem] bg-background px-5 py-6 text-foreground shadow-sm ring-1 ring-border"
    >
      <header className="text-center">
        <p className="text-xl font-black tracking-[0.16em]">PAY &amp; GO</p>
        <p className="mt-1 text-xs font-semibold tracking-[0.22em] uppercase">
          Sales receipt
        </p>
        <p className="mt-3 border-y border-dashed py-1.5 text-[11px] font-bold tracking-wide">
          TEST — NOT A TAX INVOICE
        </p>
      </header>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] leading-4">
        <dt className="font-medium">Date</dt>
        <dd className="text-right tabular-nums">
          {formatNairobiDateTime(receipt.createdAt)}
        </dd>
        <dt className="font-medium">Receipt</dt>
        <dd className="text-right font-mono text-[10px] leading-4 break-all">
          {receipt.saleId}
        </dd>
      </dl>

      <section aria-labelledby="receipt-items" className="mt-4">
        <div className="flex items-center justify-between border-y border-dashed py-1.5 text-[10px] font-bold tracking-wide uppercase">
          <h3 id="receipt-items">Item</h3>
          <span>Amount</span>
        </div>
        <ol className="divide-y divide-dashed">
          {receipt.lines.map((line) => (
            <li key={line.productId} className="py-2.5 text-xs">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 leading-4 font-semibold">{line.name}</p>
                <p className="shrink-0 font-semibold tabular-nums">
                  {money(line.lineTotalMinor)}
                </p>
              </div>
              <div className="receipt-secondary mt-1 flex items-start justify-between gap-3 text-[10px] leading-4 text-muted-foreground">
                <p className="min-w-0 break-words">SKU {line.sku}</p>
                <p className="shrink-0 text-right tabular-nums">
                  {quantity(line.quantity, line.unit)} ×{" "}
                  {money(line.unitPriceMinor)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section
        aria-label="Receipt totals"
        className="border-t-2 border-foreground pt-2"
      >
        <div className="flex items-baseline justify-between gap-4 text-base font-black">
          <span>TOTAL</span>
          <span className="tabular-nums">{money(receipt.totalMinor)}</span>
        </div>
        <p className="receipt-secondary mt-1 text-right text-[10px] text-muted-foreground">
          {lineLabel(receipt.lines.length)}
        </p>
      </section>

      <section
        aria-labelledby="receipt-payments"
        className="mt-3 border-y border-dashed py-2 text-xs"
      >
        <h3 id="receipt-payments" className="sr-only">
          Payments
        </h3>
        {receipt.payments.map((payment) => (
          <dl key={payment.paymentId} className="space-y-1">
            <div className="flex justify-between gap-3">
              <dt>{paymentNames[payment.kind]}</dt>
              <dd className="font-medium tabular-nums">
                {money(payment.amountMinor)}
              </dd>
            </div>
            {payment.kind === "cash" && (
              <div className="flex justify-between gap-3">
                <dt>Cash received</dt>
                <dd className="tabular-nums">{money(payment.tenderedMinor)}</dd>
              </div>
            )}
            {payment.changeMinor > 0 && (
              <div className="flex justify-between gap-3 font-semibold">
                <dt>Change</dt>
                <dd className="tabular-nums">{money(payment.changeMinor)}</dd>
              </div>
            )}
          </dl>
        ))}
      </section>

      <footer className="pt-4 text-center text-[10px] leading-4">
        <p className="font-semibold">Thank you for shopping with us.</p>
        <p className="receipt-secondary mt-1 text-muted-foreground">
          Keep this receipt for returns.
        </p>
        <p className="mt-3 font-mono tracking-[0.12em]">
          {receipt.saleId.slice(0, 8).toUpperCase()}
        </p>
      </footer>
    </article>
  )
}
