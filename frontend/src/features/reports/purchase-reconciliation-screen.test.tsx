import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { PurchaseReconciliationScreen } from "./purchase-reconciliation-screen"

const mocks = vi.hoisted(() => ({
  getPurchaseReconciliation: vi.fn(),
  getSupplierLedger: vi.fn(),
}))

vi.mock("./reports-api", async (original) => ({
  ...(await original<typeof import("./reports-api")>()),
  getPurchaseReconciliation: mocks.getPurchaseReconciliation,
}))

vi.mock("../purchases/purchases-api", async (original) => ({
  ...(await original<typeof import("../purchases/purchases-api")>()),
  getSupplierLedger: mocks.getSupplierLedger,
}))

const supplierId = "11111111-1111-4111-8111-111111111111"

const report = {
  from: "2026-09-01",
  to: "2026-09-22",
  summary: {
    receiptCount: 1,
    receivedTotalMinor: 20000,
    returnCount: 1,
    returnedTotalMinor: 5000,
    netPurchasesMinor: 15000,
    supplierCount: 1,
  },
  suppliers: [
    {
      supplierId,
      supplierName: "Alpha Foods",
      receiptCount: 1,
      receivedTotalMinor: 20000,
      returnCount: 1,
      returnedTotalMinor: 5000,
      netPurchasesMinor: 15000,
      lastReceiptAt: "2026-09-21T08:00:00.000Z",
    },
  ],
  receipts: [
    {
      receiptId: "22222222-2222-4222-8222-222222222222",
      supplierId,
      supplierName: "Alpha Foods",
      totalMinor: 20000,
      returnedTotalMinor: 5000,
      netTotalMinor: 15000,
      reason: "Delivery note 1042",
      createdAt: "2026-09-21T08:00:00.000Z",
      lineCount: 2,
    },
  ],
}

const ledger = {
  supplier: {
    id: supplierId,
    name: "Alpha Foods",
    createdAt: "2026-09-01T08:00:00.000Z",
  },
  from: report.from,
  to: report.to,
  hasMore: false,
  entries: [
    {
      entryId: "22222222-2222-4222-8222-222222222222",
      kind: "receipt" as const,
      receiptId: "22222222-2222-4222-8222-222222222222",
      amountMinor: 20000,
      signedMinor: 20000,
      reason: "Delivery note 1042",
      createdAt: "2026-09-21T08:00:00.000Z",
    },
    {
      entryId: "33333333-3333-4333-8333-333333333333",
      kind: "return" as const,
      receiptId: "22222222-2222-4222-8222-222222222222",
      amountMinor: 5000,
      signedMinor: -5000,
      reason: "Damaged goods",
      createdAt: "2026-09-21T09:00:00.000Z",
    },
  ],
}

beforeEach(() => {
  mocks.getPurchaseReconciliation.mockResolvedValue(report)
  mocks.getSupplierLedger.mockResolvedValue(ledger)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it("renders reconciliation totals and opens the selected supplier ledger", async () => {
  render(<PurchaseReconciliationScreen />)

  expect(await screen.findByText("Net purchases")).toBeTruthy()
  expect(screen.getByText("Delivery note 1042")).toBeTruthy()
  expect(screen.getAllByText("Alpha Foods")).toHaveLength(2)

  fireEvent.click(screen.getByRole("button", { name: "View ledger" }))

  expect(await screen.findByText("Alpha Foods ledger")).toBeTruthy()
  expect(screen.getByText("Damaged goods")).toBeTruthy()
  expect(mocks.getSupplierLedger).toHaveBeenCalledWith(
    supplierId,
    expect.any(String),
    expect.any(String)
  )
})

it("applies a valid date range and rejects an inverted range locally", async () => {
  render(<PurchaseReconciliationScreen />)
  await screen.findByText("Net purchases")
  mocks.getPurchaseReconciliation.mockClear()

  fireEvent.change(screen.getByLabelText("From"), {
    target: { value: "2026-09-01" },
  })
  fireEvent.change(screen.getByLabelText("To"), {
    target: { value: "2026-09-15" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Run report" }))

  await waitFor(() =>
    expect(mocks.getPurchaseReconciliation).toHaveBeenCalledWith(
      "2026-09-01",
      "2026-09-15",
      expect.any(AbortSignal)
    )
  )

  mocks.getPurchaseReconciliation.mockClear()
  fireEvent.change(screen.getByLabelText("From"), {
    target: { value: "2026-09-20" },
  })
  fireEvent.change(screen.getByLabelText("To"), {
    target: { value: "2026-09-10" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Run report" }))

  expect(screen.getByText("Choose a valid start and end date.")).toBeTruthy()
  expect(mocks.getPurchaseReconciliation).not.toHaveBeenCalled()
})
