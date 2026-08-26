/**
 * __tests__/NotificationCenter.test.tsx
 *
 * Tests for components/NotificationCenter.tsx — navbar bell + dropdown.
 * Runs under the jsdom test environment (real window.localStorage).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import NotificationCenter, {
  deepLinkForEvent,
  formatRelativeTime,
} from "@/components/NotificationCenter";
import { addNotification } from "@/lib/inAppNotifications";

const PK = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";

jest.mock("next/router", () => ({
  useRouter: () => ({ push: jest.fn(), pathname: "/dashboard" }),
}));

beforeEach(() => {
  window.localStorage.clear();
});

describe("deepLinkForEvent", () => {
  it("maps event types to routes", () => {
    expect(deepLinkForEvent("incoming_payment")).toBe("/transactions");
    expect(deepLinkForEvent("escrow_release")).toBe("/escrow");
    expect(deepLinkForEvent("price_alert")).toBe("/tokens");
    expect(deepLinkForEvent("unknown")).toBeNull();
  });
});

describe("formatRelativeTime", () => {
  it("formats relative time", () => {
    const now = Date.now();
    expect(formatRelativeTime(new Date(now - 60_000).toISOString())).toBe("1m");
    expect(formatRelativeTime(new Date(now - 3600_000).toISOString())).toBe("1h");
  });
});

describe("NotificationCenter bell", () => {
  it("shows no badge when there are no notifications", () => {
    render(<NotificationCenter publicKey={PK} />);
    expect(screen.getByTestId("notification-bell")).toBeInTheDocument();
    expect(screen.queryByTestId("notification-badge")).not.toBeInTheDocument();
  });

  it("shows an unread-count badge", () => {
    addNotification(PK, { eventType: "incoming_payment", message: "You received 5 XLM" });
    addNotification(PK, { eventType: "price_alert", message: "XLM up 2%" });
    render(<NotificationCenter publicKey={PK} />);
    expect(screen.getByTestId("notification-badge")).toHaveTextContent("2");
  });

  it("opens the dropdown and lists recent notifications", async () => {
    addNotification(PK, { eventType: "incoming_payment", message: "You received 5 XLM" });
    render(<NotificationCenter publicKey={PK} />);
    fireEvent.click(screen.getByTestId("notification-bell"));
    await waitFor(() => {
      expect(screen.getByTestId("notification-dropdown")).toBeInTheDocument();
    });
    expect(screen.getByText("You received 5 XLM")).toBeInTheDocument();
    expect(screen.getByTestId("view-all-notifications")).toBeInTheDocument();
  });

  it("marks a notification read when clicked", async () => {
    addNotification(PK, { eventType: "incoming_payment", message: "You received 5 XLM" });
    render(<NotificationCenter publicKey={PK} />);
    fireEvent.click(screen.getByTestId("notification-bell"));
    const item = await screen.findByText("You received 5 XLM");
    fireEvent.click(item);
    // Badge disappears after marking read.
    await waitFor(() => {
      expect(screen.queryByTestId("notification-badge")).not.toBeInTheDocument();
    });
  });

  it("shows empty state", async () => {
    render(<NotificationCenter publicKey={PK} />);
    fireEvent.click(screen.getByTestId("notification-bell"));
    await waitFor(() => {
      expect(screen.getByText("No notifications yet.")).toBeInTheDocument();
    });
  });
});
