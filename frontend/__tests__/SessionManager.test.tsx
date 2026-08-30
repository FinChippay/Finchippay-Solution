import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SessionManager from "@/components/SessionManager";
import { getSessions, revokeAllSessions, revokeSession } from "@/lib/auth";

jest.mock("@/lib/auth", () => ({
  getSessions: jest.fn(),
  revokeSession: jest.fn(),
  revokeAllSessions: jest.fn(),
}));

jest.mock("@/lib/logger", () => ({
  logger: { error: jest.fn() },
}));

const mockedGetSessions = jest.mocked(getSessions);
const mockedRevokeSession = jest.mocked(revokeSession);
const mockedRevokeAllSessions = jest.mocked(revokeAllSessions);

const sessions = [
  {
    id: 1,
    publicKey: "GPHONE",
    deviceInfo: "Phone",
    ipAddress: "127.0.0.1",
    createdAt: "2026-08-25T00:00:00Z",
    lastUsedAt: "2026-08-25T01:00:00Z",
    expiresAt: "2026-09-25T01:00:00Z",
  },
  {
    id: 2,
    publicKey: "GLAPTOP",
    deviceInfo: "Laptop",
    ipAddress: "127.0.0.2",
    createdAt: "2026-08-25T00:00:00Z",
    lastUsedAt: "2026-08-25T01:00:00Z",
    expiresAt: "2026-09-25T01:00:00Z",
  },
];

describe("SessionManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("refreshes the sessions and removes a revoked row", async () => {
    let resolveRefresh: (value: typeof sessions) => void = () => undefined;
    mockedGetSessions
      .mockResolvedValueOnce(sessions)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));
    mockedRevokeSession.mockResolvedValue(true);

    render(<SessionManager />);
    await screen.findByText("Phone");

    fireEvent.click(screen.getAllByRole("button", { name: "Revoke" })[0]);
    await waitFor(() => expect(mockedRevokeSession).toHaveBeenCalledWith(1));
    expect(screen.getByRole("button", { name: "Revoking..." })).toBeDisabled();
    expect(screen.getByText("Phone")).toBeInTheDocument();

    resolveRefresh([sessions[1]]);
    await waitFor(() => expect(screen.queryByText("Phone")).not.toBeInTheDocument());
    expect(mockedGetSessions).toHaveBeenCalledTimes(2);
  });

  it("refreshes after revoking all sessions", async () => {
    mockedGetSessions.mockResolvedValueOnce(sessions).mockResolvedValueOnce([]);
    mockedRevokeAllSessions.mockResolvedValue(true);

    render(<SessionManager />);
    await screen.findByText("Laptop");
    fireEvent.click(screen.getByRole("button", { name: "Revoke All Other Sessions" }));

    await screen.findByText("No active sessions found.");
    expect(mockedRevokeAllSessions).toHaveBeenCalledTimes(1);
    expect(mockedGetSessions).toHaveBeenCalledTimes(2);
  });
});
