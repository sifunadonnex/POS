import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { StocktakeError } from "./stocktake-api"
import { StocktakeScreen } from "./stocktake-screen"

const mocks = vi.hoisted(() => ({
  getStock: vi.fn(),
  countStock: vi.fn(),
}))

vi.mock("@/features/inventory/inventory-api", async (original) => ({
  ...(await original<typeof import("@/features/inventory/inventory-api")>()),
  getStock: mocks.getStock,
}))

vi.mock("./stocktake-api", async (original) => ({
  ...(await original<typeof import("./stocktake-api")>()),
  countStock: mocks.countStock,
}))

const productId = "11111111-1111-4111-8111-111111111111"
const row = {
  productId,
  sku: "RICE",
  name: "Loose rice",
  unit: "kg" as const,
  quantityMinor: 5250,
  active: true,
}

beforeEach(() => {
  mocks.getStock.mockResolvedValue({ stock: [row], hasMore: false })
  mocks.countStock.mockResolvedValue({
    countId: "22222222-2222-4222-8222-222222222222",
    productId,
    quantityMinor: 6250,
    deltaMinor: 1000,
    previousQuantityMinor: 5250,
  })
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it("previews a physical count and submits the exact quantity", async () => {
  render(<StocktakeScreen />)
  fireEvent.click(await screen.findByRole("button", { name: /Loose rice/ }))
  fireEvent.change(await screen.findByLabelText("Physical count"), {
    target: { value: "6.25" },
  })
  expect(screen.getByText("+1 kg")).toBeTruthy()
  fireEvent.change(screen.getByLabelText("Reason for count"), {
    target: { value: "Weekly shelf count" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Confirm stocktake" }))

  await waitFor(() => expect(mocks.countStock).toHaveBeenCalledOnce())
  expect(mocks.countStock).toHaveBeenCalledWith({
    productId,
    quantity: "6.25",
    reason: "Weekly shelf count",
    requestId: expect.any(String),
  })
  expect((await screen.findByRole("status")).textContent).toContain("confirmed")
})

it("retries an uncertain count with the same request and request ID", async () => {
  mocks.countStock
    .mockRejectedValueOnce(new StocktakeError("Connection lost", 0))
    .mockResolvedValueOnce({
      countId: "count-1",
      productId,
      quantityMinor: 6250,
      deltaMinor: 1000,
      previousQuantityMinor: 5250,
    })
  render(<StocktakeScreen />)
  fireEvent.click(await screen.findByRole("button", { name: /Loose rice/ }))
  fireEvent.change(await screen.findByLabelText("Physical count"), {
    target: { value: "6.25" },
  })
  fireEvent.change(screen.getByLabelText("Reason for count"), {
    target: { value: "Weekly shelf count" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Confirm stocktake" }))

  fireEvent.click(
    await screen.findByRole("button", { name: "Retry same stocktake" })
  )
  await waitFor(() => expect(mocks.countStock).toHaveBeenCalledTimes(2))
  expect(mocks.countStock.mock.calls[1]).toEqual(mocks.countStock.mock.calls[0])
})
