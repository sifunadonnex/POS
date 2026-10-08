import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { StockPositionScreen } from "./stock-position-screen"

const mocks = vi.hoisted(() => ({ getStockPosition: vi.fn() }))
vi.mock("./reports-api", async (original) => ({
  ...(await original<typeof import("./reports-api")>()),
  getStockPosition: mocks.getStockPosition,
}))

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it("shows the authoritative edge quantity and a lag warning", async () => {
  mocks.getStockPosition.mockResolvedValue({
    source: "edge",
    storeId: "11111111-1111-4111-8111-111111111111",
    reportingLag: {
      status: "lagging",
      pendingEvents: 0,
      receivedEvents: 5,
      projectedEvents: 4,
      latestReceivedAt: null,
    },
    products: [
      {
        productId: "22222222-2222-4222-8222-222222222222",
        sku: "RICE",
        name: "Rice",
        unit: "kg",
        quantityMinor: 1250,
        movementCount: 2,
      },
    ],
  })
  render(<StockPositionScreen />)
  expect(await screen.findByText("Rice")).toBeTruthy()
  expect(screen.getByText("1.25 kg")).toBeTruthy()
  expect(screen.getByText("Synchronized store")).toBeTruthy()
  expect(screen.getByText(/may be behind the shop PC/)).toBeTruthy()
})
