import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ReturnsError } from "./returns-api"
import { ReturnsScreen } from "./returns-screen"

const mocks = vi.hoisted(() => ({
  getSales: vi.fn(),
  getSale: vi.fn(),
  createReturn: vi.fn(),
}))

vi.mock("./returns-api", async (original) => ({
  ...(await original<typeof import("./returns-api")>()),
  ...mocks,
}))

const saleId = "11111111-1111-4111-8111-111111111111"
const productId = "22222222-2222-4222-8222-222222222222"
const summary = {
  saleId,
  totalMinor: 1000,
  refundedMinor: 0,
  refundableMinor: 1000,
  createdAt: "2026-09-21T09:00:00.000Z",
}
const sale = {
  ...summary,
  lines: [
    {
      productId,
      name: "Milk",
      sku: "MILK",
      unit: "each" as const,
      soldQuantityMinor: 2,
      returnedQuantityMinor: 0,
      availableQuantityMinor: 2,
      unitPriceMinor: 500,
    },
  ],
}

beforeEach(() => {
  mocks.getSales.mockResolvedValue({ sales: [summary], hasMore: false })
  mocks.getSale.mockResolvedValue(sale)
  mocks.createReturn.mockResolvedValue({
    returnId: "33333333-3333-4333-8333-333333333333",
    saleId,
    amountMinor: 500,
    refundId: "44444444-4444-4444-8444-444444444444",
  })
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it("selects a completed sale and submits an exact return quantity", async () => {
  render(<ReturnsScreen />)
  expect(
    await screen.findByRole("button", { name: /Sale 11111111/ })
  ).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: /Sale 11111111/ }))
  fireEvent.change(await screen.findByLabelText("Return quantity"), {
    target: { value: "1" },
  })
  fireEvent.change(screen.getByLabelText("Reason for return"), {
    target: { value: "Customer changed mind" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Confirm return" }))

  await waitFor(() => expect(mocks.createReturn).toHaveBeenCalledOnce())
  expect(mocks.createReturn).toHaveBeenCalledWith({
    saleId,
    reason: "Customer changed mind",
    requestId: expect.any(String),
    lines: [{ productId, quantityMinor: "1" }],
  })
  expect((await screen.findByRole("status")).textContent).toContain("confirmed")
})

it("retries an uncertain return with the same request and request ID", async () => {
  mocks.createReturn
    .mockRejectedValueOnce(new ReturnsError("Connection lost", 0))
    .mockResolvedValueOnce({
      returnId: "return-1",
      saleId,
      amountMinor: 500,
      refundId: "refund-1",
    })
  render(<ReturnsScreen />)
  fireEvent.click(await screen.findByRole("button", { name: /Sale 11111111/ }))
  fireEvent.change(await screen.findByLabelText("Return quantity"), {
    target: { value: "1" },
  })
  fireEvent.change(screen.getByLabelText("Reason for return"), {
    target: { value: "Customer changed mind" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Confirm return" }))

  fireEvent.click(
    await screen.findByRole("button", { name: "Retry same return" })
  )
  await waitFor(() => expect(mocks.createReturn).toHaveBeenCalledTimes(2))
  expect(mocks.createReturn.mock.calls[1]).toEqual(
    mocks.createReturn.mock.calls[0]
  )
})
