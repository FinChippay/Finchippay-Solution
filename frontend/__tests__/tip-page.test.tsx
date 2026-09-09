import { render, screen, waitFor } from "@testing-library/react";
import { useRouter } from "next/router";
import TipPage from "@/pages/tip/[username]";

jest.mock("next/router", () => ({
  useRouter: jest.fn(),
}));

jest.mock("@/components/TipWidget", () => ({
  __esModule: true,
  default: ({ creatorUsername, destination }: { creatorUsername: string; destination: string }) => (
    <div data-testid="tip-widget">
      {creatorUsername}:{destination}
    </div>
  ),
}));

// The page resolves the creator through the shared apiClient singleton, whose
// fetch is bound at construction (before any per-test fetch mock is set). Mock
// the client boundary so each test controls the resolve outcome deterministically.
const mockResolveUsername = jest.fn();

jest.mock("@/lib/api", () => ({
  apiClient: {
    accounts: {
      resolveUsername: (...args: unknown[]) => mockResolveUsername(...args),
    },
  },
  apiFetch: jest.fn(),
}));

describe("tip page", () => {
  beforeEach(() => {
    (useRouter as jest.Mock).mockReturnValue({
      isReady: true,
      query: { username: "alice" },
    });

    mockResolveUsername.mockReset();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("loads the tip widget for a resolved username", async () => {
    mockResolveUsername.mockResolvedValue({
      data: {
        username: "alice",
        publicKey: `G${"A".repeat(55)}`,
      },
    });

    render(<TipPage />);

    await waitFor(() => {
      expect(screen.getByTestId("tip-widget")).toHaveTextContent(`alice:G${"A".repeat(55)}`);
    });

    expect(mockResolveUsername).toHaveBeenCalledWith("alice");
  });

  it("shows a friendly not-found state for an invalid username", async () => {
    mockResolveUsername.mockRejectedValue({
      status: 404,
      message: "Username not found",
    });

    render(<TipPage />);

    await waitFor(() => {
      expect(screen.getByText("Creator not found")).toBeInTheDocument();
    });

    expect(screen.getByText("Username not found")).toBeInTheDocument();
  });
});
