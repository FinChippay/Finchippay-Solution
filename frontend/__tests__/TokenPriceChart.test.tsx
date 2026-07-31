/**
 * __tests__/TokenPriceChart.test.tsx
 * Unit tests for TokenPriceChart (issue #362).
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TokenPriceChart from "@/components/TokenPriceChart";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const CONTRACT_ID = `C${"A".repeat(55)}`;
const ORIGINAL_FETCH = global.fetch;

function makeResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  jest.clearAllMocks();
});

describe("TokenPriceChart", () => {
  it("fetches the 30d range by default", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse({ contractId: CONTRACT_ID, range: "30d", prices: [{ timestamp: 1, price: 0.1 }] })
    );
    global.fetch = fetchMock;

    render(<TokenPriceChart contractId={CONTRACT_ID} code="XLM" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toContain(`/api/v1/tokens/${CONTRACT_ID}/price-history?range=30d`);
  });

  it("refetches with the new range when a range button is clicked", async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeResponse({ prices: [{ timestamp: 1, price: 0.1 }] }));
    global.fetch = fetchMock;
    const user = userEvent.setup();

    render(<TokenPriceChart contractId={CONTRACT_ID} code="XLM" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "portfolio.range7d" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toContain("range=7d");
  });

  it("shows an unavailable message when the backend returns no price history", async () => {
    global.fetch = jest.fn().mockResolvedValue(makeResponse({ prices: [] }));

    render(<TokenPriceChart contractId={CONTRACT_ID} code="XLM" />);

    expect(await screen.findByText("portfolio.priceHistoryUnavailable")).toBeInTheDocument();
  });

  it("shows an unavailable message when the request fails", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("network down"));

    render(<TokenPriceChart contractId={CONTRACT_ID} code="XLM" />);

    expect(await screen.findByText("portfolio.priceHistoryUnavailable")).toBeInTheDocument();
  });
});
