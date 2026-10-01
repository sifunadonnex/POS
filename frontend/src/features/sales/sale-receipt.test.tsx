import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import type { SaleReceipt } from "./sales-api"
import { SaleReceiptView } from "./sale-receipt"

const receipt: SaleReceipt = {
  saleId: "11111111-1111-4111-8111-111111111111",
  totalMinor: 18138,
  createdAt: "2026-09-21T08:00:00.000Z",
  lines: [
    {
      productId: "product-1",
      name: "Kenyan Premium Rice 10kg",
      sku: "RICE-10KG",
      unit: "each",
      quantity: 1,
      unitPriceMinor: 12500,
      lineTotalMinor: 12500,
    },
    {
      productId: "product-2",
      name: "Fresh produce",
      sku: "PRODUCE",
      unit: "kg",
      quantity: 1.25,
      unitPriceMinor: 4510,
      lineTotalMinor: 5638,
    },
  ],
  payments: [
    {
      paymentId: "payment-1",
      kind: "cash",
      amountMinor: 18138,
      tenderedMinor: 20000,
      changeMinor: 1862,
      paidAt: "2026-09-21T08:00:01.000Z",
    },
  ],
}

afterEach(cleanup)

it("renders a compact itemized supermarket receipt from server values", () => {
  render(<SaleReceiptView receipt={receipt} />)

  const printable = screen.getByLabelText("Printable receipt")
  expect(printable.hasAttribute("data-print-receipt")).toBe(true)
  expect(screen.getByText("PAY & GO")).toBeTruthy()
  expect(screen.getByText("TEST — NOT A TAX INVOICE")).toBeTruthy()
  expect(screen.getByText("Kenyan Premium Rice 10kg")).toBeTruthy()
  expect(screen.getByText("SKU RICE-10KG")).toBeTruthy()
  expect(screen.getByText("1.25 kg × KES 45.10")).toBeTruthy()
  expect(screen.getAllByText("KES 181.38")).toHaveLength(2)
  expect(screen.getByText("Cash received")).toBeTruthy()
  expect(screen.getByText("KES 200.00")).toBeTruthy()
  expect(screen.getByText("Change")).toBeTruthy()
  expect(screen.getByText("KES 18.62")).toBeTruthy()
  expect(screen.getByText("Keep this receipt for returns.")).toBeTruthy()
})
