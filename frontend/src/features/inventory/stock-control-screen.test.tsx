import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { InventoryError } from "./inventory-api"
import { StockControlScreen } from "./stock-control-screen"

const mocks = vi.hoisted(() => ({
  getStock: vi.fn(),
  getHistory: vi.fn(),
  changeStock: vi.fn(),
}))

vi.mock("./inventory-api", async (original) => ({
  ...(await original<typeof import("./inventory-api")>()),
  ...mocks,
}))

const stock = {
  productId: "11111111-1111-4111-8111-111111111111",
  sku: "RICE",
  name: "Loose rice",
  unit: "kg" as const,
  quantityMinor: 1250,
  active: true,
}

beforeEach(() => {
  mocks.getStock.mockResolvedValue({ stock: [stock], hasMore: false })
  mocks.getHistory.mockResolvedValue({ history: [], hasMore: false })
  mocks.changeStock.mockResolvedValue({
    productId: stock.productId,
    unit: stock.unit,
    quantityMinor: 2250,
    movementId: "movement-1",
  })
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it("posts an exact unit-aware stock change and refreshes the balance", async () => {
  render(<StockControlScreen />)
  expect((await screen.findAllByText("Loose rice")).length).toBeGreaterThan(0)

  fireEvent.change(screen.getByLabelText("Quantity (kg)"), {
    target: { value: "1.000" },
  })
  fireEvent.change(screen.getByLabelText("Reason for change"), {
    target: { value: "Delivery note 1042" },
  })
  fireEvent.click(
    screen.getAllByRole("button", { name: "Receive stock" }).at(-1)!
  )

  await waitFor(() => expect(mocks.changeStock).toHaveBeenCalledOnce())
  expect(mocks.changeStock).toHaveBeenCalledWith("receive", {
    productId: stock.productId,
    quantity: "1.000",
    reason: "Delivery note 1042",
    requestId: expect.any(String),
  })
  expect((await screen.findByRole("status")).textContent).toContain("confirmed")
  expect(screen.getByText("2.25")).toBeTruthy()
})

it("retries an uncertain stock change with the same request ID and payload", async () => {
  mocks.changeStock
    .mockRejectedValueOnce(new InventoryError("Connection lost", 0))
    .mockResolvedValueOnce({
      productId: stock.productId,
      unit: stock.unit,
      quantityMinor: 2250,
      movementId: "movement-1",
    })

  render(<StockControlScreen />)
  await screen.findAllByText("Loose rice")
  fireEvent.change(screen.getByLabelText("Quantity (kg)"), {
    target: { value: "1.000" },
  })
  fireEvent.change(screen.getByLabelText("Reason for change"), {
    target: { value: "Delivery note 1042" },
  })
  fireEvent.click(
    screen.getAllByRole("button", { name: "Receive stock" }).at(-1)!
  )

  const retry = await screen.findByRole("button", {
    name: "Retry same stock change",
  })
  fireEvent.click(retry)
  await waitFor(() => expect(mocks.changeStock).toHaveBeenCalledTimes(2))
  expect(mocks.changeStock.mock.calls[1]).toEqual(
    mocks.changeStock.mock.calls[0]
  )
})

it("shows a rejected adjustment without claiming it was posted", async () => {
  mocks.changeStock.mockRejectedValueOnce(
    new InventoryError("Insufficient stock", 409)
  )
  render(<StockControlScreen />)
  await screen.findAllByText("Loose rice")
  fireEvent.click(screen.getByRole("button", { name: "Adjust stock" }))
  fireEvent.change(screen.getByLabelText("Quantity (kg)"), {
    target: { value: "-2.000" },
  })
  fireEvent.change(screen.getByLabelText("Reason for change"), {
    target: { value: "Cycle count correction" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Post adjustment" }))

  expect((await screen.findByRole("alert")).textContent).toContain(
    "Insufficient stock"
  )
  expect(screen.queryByRole("status")).toBeNull()
})
