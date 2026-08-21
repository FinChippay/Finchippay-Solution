import type { Transaction } from "@stellar/stellar-sdk";
import { render, screen, waitFor } from "@testing-library/react";
import FeeEstimator from "@/components/FeeEstimator";
import { estimateAccurateFee } from "@/lib/fees";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock("@/lib/fees", () => {
  const actual = jest.requireActual("@/lib/fees");
  return {
    ...actual,
    getFeeStats: jest.fn(),
    estimateAccurateFee: jest.fn(),
  };
});

const transaction = {
  operations: [{ type: "invokeHostFunction" }],
} as unknown as Transaction;

describe("FeeEstimator", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders simulated resources, Horizon fee range, and total stroops", async () => {
    jest.mocked(estimateAccurateFee).mockResolvedValue({
      baseFeeStroops: 200,
      minBaseFeeStroops: 100,
      maxBaseFeeStroops: 1000,
      resourceFeeStroops: 5000,
      totalFeeStroops: 5200,
      cpuInstructions: 123456,
      readBytes: 2048,
      writeBytes: 512,
      simulated: true,
      warning: null,
    });

    render(
      <FeeEstimator transaction={transaction} amount="5" asset="XLM" onFeeSelected={jest.fn()} />,
    );

    expect(await screen.findByText("123,456")).toBeInTheDocument();
    expect(screen.getByText("2,048")).toBeInTheDocument();
    expect(screen.getByText("100–1,000 stroops")).toBeInTheDocument();
    expect(screen.getByText("5,200 stroops")).toBeInTheDocument();
  });

  it("shows a visible warning when simulation uses fallback", async () => {
    jest.mocked(estimateAccurateFee).mockResolvedValue({
      baseFeeStroops: 1000,
      minBaseFeeStroops: 100,
      maxBaseFeeStroops: 1000,
      resourceFeeStroops: 1_000_000,
      totalFeeStroops: 1_001_000,
      cpuInstructions: 0,
      readBytes: 0,
      writeBytes: 0,
      simulated: false,
      warning: "Soroban simulation is unavailable; using a conservative fallback estimate.",
    });

    render(
      <FeeEstimator transaction={transaction} amount="5" asset="XLM" onFeeSelected={jest.fn()} />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("conservative fallback");
  });

  it("re-estimates when transaction inputs change", async () => {
    jest.mocked(estimateAccurateFee).mockResolvedValue({
      baseFeeStroops: 100,
      minBaseFeeStroops: 100,
      maxBaseFeeStroops: 1000,
      resourceFeeStroops: 10,
      totalFeeStroops: 110,
      cpuInstructions: 1,
      readBytes: 2,
      writeBytes: 3,
      simulated: true,
      warning: null,
    });
    const { rerender } = render(
      <FeeEstimator transaction={transaction} amount="5" asset="XLM" onFeeSelected={jest.fn()} />,
    );
    await waitFor(() => expect(estimateAccurateFee).toHaveBeenCalledTimes(1));
    rerender(
      <FeeEstimator transaction={transaction} amount="6" asset="XLM" onFeeSelected={jest.fn()} />,
    );
    await waitFor(() => expect(estimateAccurateFee).toHaveBeenCalledTimes(2));
  });
});
