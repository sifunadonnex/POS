import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { StoreDocumentsScreen } from "./store-documents-screen"

const mocks = vi.hoisted(() => ({ getOperationDocuments: vi.fn() }))
vi.mock("./reports-api", async (original) => ({
  ...(await original<typeof import("./reports-api")>()),
  getOperationDocuments: mocks.getOperationDocuments,
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it("shows delivered supplier and zero-change stocktake documents with a queue caveat", async () => {
  mocks.getOperationDocuments.mockResolvedValue({
    from: "2026-10-08",
    to: "2026-10-08",
    page: 1,
    total: 2,
    storeId: "11111111-1111-4111-8111-111111111111",
    source: "edge",
    documents: [
      {
        eventId: "receipt",
        documentId: "22222222",
        eventType: "purchase_receipt.received",
        occurredAt: "2026-10-08T10:00:00Z",
        actorName: "Amina",
        reason: "Supplier delivery",
        supplierName: "Market Foods",
        totalMinor: 300,
        lines: [
          {
            lineId: "line",
            productName: "Rice",
            sku: "RICE",
            unit: "each",
            quantityMinor: 3,
            lineTotalMinor: 300,
          },
        ],
      },
      {
        eventId: "count",
        documentId: "33333333",
        eventType: "stocktake.counted",
        occurredAt: "2026-10-08T11:00:00Z",
        actorName: "Amina",
        reason: "Shelf count",
        productName: "Rice",
        sku: "RICE",
        unit: "each",
        previousQuantityMinor: 6,
        countedQuantityMinor: 6,
        deltaMinor: 0,
      },
    ],
  })
  render(<StoreDocumentsScreen />)
  expect(await screen.findByText("Supplier receipt")).toBeTruthy()
  expect(screen.getByText("Stocktake count")).toBeTruthy()
  expect(screen.getByText(/Market Foods/)).toBeTruthy()
  expect(screen.getByText(/6 each → 6 each · Change 0 each/)).toBeTruthy()
  expect(screen.getByText(/still queued on an offline shop PC/)).toBeTruthy()
})
