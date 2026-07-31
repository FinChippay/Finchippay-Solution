/**
 * __tests__/push-notification-prompt.test.tsx
 *
 * Test suite for components/PushNotificationPrompt (Issue #385).
 * Covers: when the prompt appears, the Enable path, the "Not Now" path and the
 *         no-nag guarantee, and staying silent when push cannot work.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PushNotificationPrompt } from "@/components/PushNotificationPrompt";

const PUBLIC_KEY = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";

const mockShowToast = jest.fn();
jest.mock("@/lib/useToast", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

const mockShouldShowPrompt = jest.fn();
const mockGetVapidPublicKey = jest.fn();
const mockRequestPermission = jest.fn();
const mockSetOptIn = jest.fn();
const mockDismissPrompt = jest.fn();

jest.mock("@/lib/pushNotifications", () => ({
  shouldShowPrompt: () => mockShouldShowPrompt(),
  getVapidPublicKey: () => mockGetVapidPublicKey(),
  requestPermission: (publicKey?: string) => mockRequestPermission(publicKey),
  setOptIn: (value: boolean) => mockSetOptIn(value),
  dismissPrompt: () => mockDismissPrompt(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockShouldShowPrompt.mockReturnValue(true);
  mockGetVapidPublicKey.mockResolvedValue("vapid-public-key");
  mockRequestPermission.mockResolvedValue({
    permission: "granted",
    subscribed: true,
  });
});

/** The prompt decides visibility in an effect, so wait for it to settle. */
async function renderPrompt(props: Record<string, unknown> = {}) {
  const user = userEvent.setup();
  const utils = render(
    <PushNotificationPrompt publicKey={PUBLIC_KEY} {...props} />,
  );
  return { user, ...utils };
}

describe("visibility", () => {
  it("offers the benefit up front once a wallet is connected", async () => {
    await renderPrompt();

    expect(
      await screen.findByText(/get notified when you receive payments/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enable/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /not now/i })).toBeInTheDocument();
  });

  it("stays hidden until a wallet is connected", async () => {
    await renderPrompt({ publicKey: null });

    await waitFor(() => expect(mockGetVapidPublicKey).not.toHaveBeenCalled());
    expect(
      screen.queryByText(/get notified when you receive payments/i),
    ).not.toBeInTheDocument();
  });

  it("stays hidden when the user already answered", async () => {
    mockShouldShowPrompt.mockReturnValue(false);
    await renderPrompt();

    await waitFor(() => expect(mockShouldShowPrompt).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /enable/i })).not.toBeInTheDocument();
  });

  it("does not ask for a permission the server cannot use", async () => {
    // No VAPID key configured anywhere: a granted permission would deliver
    // nothing, so the prompt should never appear.
    mockGetVapidPublicKey.mockResolvedValue(null);
    await renderPrompt();

    await waitFor(() => expect(mockGetVapidPublicKey).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /enable/i })).not.toBeInTheDocument();
  });
});

describe("Enable", () => {
  it("requests permission for the connected account and records the opt-in", async () => {
    const onResolved = jest.fn();
    const { user } = await renderPrompt({ onResolved });

    await user.click(await screen.findByRole("button", { name: /enable/i }));

    expect(mockRequestPermission).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(mockSetOptIn).toHaveBeenCalledWith(true);
    expect(onResolved).toHaveBeenCalledWith(true);
    expect(mockShowToast).toHaveBeenCalledWith("Notifications enabled", "success");
  });

  it("dismisses itself after a grant so it cannot ask twice", async () => {
    const { user } = await renderPrompt();

    await user.click(await screen.findByRole("button", { name: /enable/i }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /enable/i })).not.toBeInTheDocument(),
    );
  });

  it("explains when permission was granted but the device could not register", async () => {
    mockRequestPermission.mockResolvedValue({
      permission: "granted",
      subscribed: false,
    });
    const { user } = await renderPrompt();

    await user.click(await screen.findByRole("button", { name: /enable/i }));

    expect(mockShowToast).toHaveBeenCalledWith(
      expect.stringMatching(/could not be registered/i),
      "info",
    );
  });

  it("stops asking when the browser permission is denied", async () => {
    mockRequestPermission.mockResolvedValue({
      permission: "denied",
      subscribed: false,
    });
    const onResolved = jest.fn();
    const { user } = await renderPrompt({ onResolved });

    await user.click(await screen.findByRole("button", { name: /enable/i }));

    expect(mockDismissPrompt).toHaveBeenCalled();
    expect(mockSetOptIn).not.toHaveBeenCalled();
    expect(onResolved).toHaveBeenCalledWith(false);
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.stringMatching(/blocked/i),
      "info",
    );
  });

  it("surfaces an error instead of failing silently", async () => {
    mockRequestPermission.mockRejectedValue(new Error("boom"));
    const { user } = await renderPrompt();

    await user.click(await screen.findByRole("button", { name: /enable/i }));

    expect(mockShowToast).toHaveBeenCalledWith(
      expect.stringMatching(/could not enable notifications/i),
      "error",
    );
  });
});

describe("Not Now", () => {
  it("records the dismissal and hides the prompt without asking the browser", async () => {
    const onResolved = jest.fn();
    const { user } = await renderPrompt({ onResolved });

    await user.click(await screen.findByRole("button", { name: /not now/i }));

    expect(mockDismissPrompt).toHaveBeenCalled();
    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(onResolved).toHaveBeenCalledWith(false);
    expect(
      screen.queryByRole("button", { name: /not now/i }),
    ).not.toBeInTheDocument();
  });
});
