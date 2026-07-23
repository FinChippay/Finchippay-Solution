/**
 * __tests__/wallet-multi-account.test.tsx
 * Coverage for the multi-account wallet store (#147): add, switch, remove,
 * label, and localStorage persistence.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { STORAGE_KEY, WalletProvider, useWallet } from "@/lib/useWallet";
import AccountSwitcher from "@/components/AccountSwitcher";

const KEY_A = "GA" + "A".repeat(54);
const KEY_B = "GB" + "B".repeat(54);
const KEY_C = "GC" + "C".repeat(54);

const push = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ push, pathname: "/dashboard", query: {} }),
}));

const getConnectedPublicKey = jest.fn();
const requestWalletConnection = jest.fn();
const performSEP0010Auth = jest.fn();
const clearWalletConnection = jest.fn();

jest.mock("@/lib/wallet", () => ({
  getConnectedPublicKey: (...args: unknown[]) => getConnectedPublicKey(...args),
  connectWallet: (...args: unknown[]) => requestWalletConnection(...args),
  performSEP0010Auth: (...args: unknown[]) => performSEP0010Auth(...args),
  disconnectWallet: (...args: unknown[]) => clearWalletConnection(...args),
}));

// `@/lib/stellar` pulls in the Stellar SDK, which the switcher does not need.
jest.mock("@/lib/stellar", () => ({
  shortenAddress: (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`,
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/** Test harness exposing the wallet context through simple DOM controls. */
function WalletHarness() {
  const {
    accounts,
    activeAccount,
    activeAccountIndex,
    publicKey,
    isWalletReady,
    setActiveAccount,
    addAccount,
    removeAccount,
    setAccountLabel,
  } = useWallet();

  return (
    <div>
      <span data-testid="ready">{String(isWalletReady)}</span>
      <span data-testid="count">{accounts.length}</span>
      <span data-testid="active-index">{activeAccountIndex}</span>
      <span data-testid="active-key">{activeAccount?.publicKey ?? "none"}</span>
      <span data-testid="public-key">{publicKey ?? "none"}</span>
      <span data-testid="active-label">{activeAccount?.label ?? "unlabeled"}</span>
      <span data-testid="primary-key">
        {accounts.find((a) => a.isPrimary)?.publicKey ?? "none"}
      </span>

      <button onClick={() => void addAccount()}>add</button>
      <button onClick={() => setActiveAccount(1)}>activate-second</button>
      <button onClick={() => setActiveAccount(0)}>activate-first</button>
      <button onClick={() => removeAccount(KEY_A)}>remove-a</button>
      <button onClick={() => removeAccount(KEY_B)}>remove-b</button>
      <button onClick={() => setAccountLabel(KEY_A, "Business")}>label-a</button>
    </div>
  );
}

async function renderWallet() {
  render(
    <WalletProvider>
      <WalletHarness />
    </WalletProvider>
  );
  await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"));
}

function storedAccounts() {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
}

beforeEach(() => {
  window.localStorage.clear();
  jest.clearAllMocks();
  getConnectedPublicKey.mockResolvedValue(KEY_A);
  performSEP0010Auth.mockResolvedValue({ token: "jwt", error: null });
  requestWalletConnection.mockResolvedValue({ publicKey: KEY_B, error: null });
});

describe("multi-account wallet", () => {
  it("seeds the list from the account Freighter already exposes", async () => {
    await renderWallet();

    expect(screen.getByTestId("count")).toHaveTextContent("1");
    expect(screen.getByTestId("active-key")).toHaveTextContent(KEY_A);
    expect(screen.getByTestId("public-key")).toHaveTextContent(KEY_A);
    expect(screen.getByTestId("primary-key")).toHaveTextContent(KEY_A);
  });

  it("adds a second account and makes it active", async () => {
    await renderWallet();

    await userEvent.click(screen.getByText("add"));

    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));
    expect(screen.getByTestId("active-key")).toHaveTextContent(KEY_B);
    expect(performSEP0010Auth).toHaveBeenCalledWith(KEY_B);
    // The first account stays primary regardless of which one is active.
    expect(screen.getByTestId("primary-key")).toHaveTextContent(KEY_A);
  });

  it("does not duplicate an account that is already connected", async () => {
    requestWalletConnection.mockResolvedValue({ publicKey: KEY_A, error: null });
    await renderWallet();

    await userEvent.click(screen.getByText("add"));

    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
    expect(screen.getByTestId("active-key")).toHaveTextContent(KEY_A);
  });

  it("surfaces the error when adding an account fails", async () => {
    requestWalletConnection.mockResolvedValue({
      publicKey: null,
      error: "Connection rejected.",
    });
    await renderWallet();

    await userEvent.click(screen.getByText("add"));

    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
    expect(performSEP0010Auth).not.toHaveBeenCalled();
  });

  it("switches the active account without touching the list", async () => {
    await renderWallet();
    await userEvent.click(screen.getByText("add"));
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));

    await userEvent.click(screen.getByText("activate-first"));

    expect(screen.getByTestId("active-index")).toHaveTextContent("0");
    expect(screen.getByTestId("public-key")).toHaveTextContent(KEY_A);

    await userEvent.click(screen.getByText("activate-second"));

    expect(screen.getByTestId("active-index")).toHaveTextContent("1");
    expect(screen.getByTestId("public-key")).toHaveTextContent(KEY_B);
  });

  it("keeps a valid active account after removing one", async () => {
    await renderWallet();
    await userEvent.click(screen.getByText("add"));
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));

    // KEY_B is active (index 1); removing KEY_A must shift the index down.
    await userEvent.click(screen.getByText("remove-a"));

    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
    expect(screen.getByTestId("active-index")).toHaveTextContent("0");
    expect(screen.getByTestId("active-key")).toHaveTextContent(KEY_B);
    expect(screen.getByTestId("primary-key")).toHaveTextContent(KEY_B);
  });

  it("disconnects the wallet when the last account is removed", async () => {
    await renderWallet();

    await userEvent.click(screen.getByText("remove-a"));

    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("0"));
    expect(screen.getByTestId("public-key")).toHaveTextContent("none");
    expect(clearWalletConnection).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("stores labels and persists the account list", async () => {
    await renderWallet();
    await userEvent.click(screen.getByText("add"));
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));

    await userEvent.click(screen.getByText("label-a"));

    await waitFor(() => expect(storedAccounts()).toHaveLength(2));
    expect(storedAccounts()).toEqual([
      { publicKey: KEY_A, label: "Business", isPrimary: true },
      { publicKey: KEY_B, isPrimary: false },
    ]);
  });

  it("restores accounts and labels from localStorage on reload", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { publicKey: KEY_A, label: "Personal", isPrimary: true },
        { publicKey: KEY_B, label: "Business", isPrimary: false },
      ])
    );

    await renderWallet();

    expect(screen.getByTestId("count")).toHaveTextContent("2");
    expect(screen.getByTestId("active-key")).toHaveTextContent(KEY_A);
    expect(screen.getByTestId("active-label")).toHaveTextContent("Personal");
  });

  it("migrates the pre-#147 single-key storage entry", async () => {
    window.localStorage.setItem("finchippay:last-public-key", KEY_C);
    getConnectedPublicKey.mockResolvedValue(KEY_C);

    await renderWallet();

    expect(screen.getByTestId("count")).toHaveTextContent("1");
    expect(screen.getByTestId("active-key")).toHaveTextContent(KEY_C);
    await waitFor(() => expect(storedAccounts()).toHaveLength(1));
  });

  it("appends the Freighter account without stealing the active selection", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ publicKey: KEY_A, isPrimary: true }])
    );
    getConnectedPublicKey.mockResolvedValue(KEY_C);

    await renderWallet();

    expect(screen.getByTestId("count")).toHaveTextContent("2");
    expect(screen.getByTestId("active-key")).toHaveTextContent(KEY_A);
  });

  it("clears stored accounts when Freighter revokes site access", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ publicKey: KEY_A, isPrimary: true }])
    );
    getConnectedPublicKey.mockResolvedValue(null);

    await renderWallet();

    expect(screen.getByTestId("count")).toHaveTextContent("0");
    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull());
  });

  it("ignores malformed entries in storage", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { publicKey: "not-a-key", isPrimary: true },
        { publicKey: KEY_A, isPrimary: false },
        { publicKey: KEY_A, isPrimary: false },
      ])
    );

    await renderWallet();

    expect(screen.getByTestId("count")).toHaveTextContent("1");
    expect(screen.getByTestId("primary-key")).toHaveTextContent(KEY_A);
  });
});

describe("AccountSwitcher", () => {
  async function renderSwitcher() {
    render(
      <WalletProvider>
        <AccountSwitcher />
      </WalletProvider>
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "nav.switchAccount" })).toBeInTheDocument()
    );
  }

  beforeEach(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { publicKey: KEY_A, label: "Personal", isPrimary: true },
        { publicKey: KEY_B, label: "Business", isPrimary: false },
      ])
    );
  });

  it("lists every account and switches on selection", async () => {
    await renderSwitcher();

    const trigger = screen.getByRole("button", { name: "nav.switchAccount" });
    expect(trigger).toHaveTextContent("Personal");

    await userEvent.click(trigger);

    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Personal")).toBeInTheDocument();
    expect(within(menu).getByText("Business")).toBeInTheDocument();

    await userEvent.click(within(menu).getByText("Business"));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "nav.switchAccount" })).toHaveTextContent(
      "Business"
    );
  });

  it("opens with Ctrl+K and closes with Escape", async () => {
    await renderSwitcher();

    await userEvent.keyboard("{Control>}k{/Control}");
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens with Cmd+K on macOS", async () => {
    await renderSwitcher();

    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("removes an account from the menu", async () => {
    await renderSwitcher();

    await userEvent.click(screen.getByRole("button", { name: "nav.switchAccount" }));
    await userEvent.click(
      screen.getByRole("button", { name: "nav.removeAccount: Business" })
    );

    await userEvent.click(screen.getByRole("button", { name: "nav.switchAccount" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByText("Business")).not.toBeInTheDocument();
    expect(within(menu).getByText("Personal")).toBeInTheDocument();
  });

  it("requires a second click before removing the only account", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ publicKey: KEY_A, label: "Personal", isPrimary: true }])
    );
    await renderSwitcher();

    await userEvent.click(screen.getByRole("button", { name: "nav.switchAccount" }));
    const removeButton = screen.getByRole("button", {
      name: "nav.removeAccount: Personal",
    });

    await userEvent.click(removeButton);
    expect(screen.getByText("nav.removeLastAccountWarning")).toBeInTheDocument();
    expect(clearWalletConnection).not.toHaveBeenCalled();

    await userEvent.click(removeButton);
    await waitFor(() => expect(clearWalletConnection).toHaveBeenCalled());
    expect(push).toHaveBeenCalledWith("/");
  });
});
