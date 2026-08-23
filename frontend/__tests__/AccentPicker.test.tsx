import { ThemeProvider } from "@/lib/ThemeContext";
import AccentPicker from "@/components/AccentPicker";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock useTranslation
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "settings.accentTitle": "Accent Color",
        "settings.accentDescription":
          "Choose a custom accent color that applies app-wide to buttons, links, and highlights.",
        "settings.accentStellar": "Sky",
        "settings.accentTeal": "Teal",
        "settings.accentAmber": "Amber",
        "settings.accentRose": "Rose",
        "settings.accentViolet": "Violet",
      };
      return map[key] || key;
    },
  }),
}));

const ACCENT_STORAGE_KEY = "finchippay:accent";

describe("AccentPicker (Issue #46)", () => {
  beforeEach(() => {
    window.localStorage.clear();

    document.documentElement.removeAttribute("data-accent");
  });

  afterEach(() => {
    window.localStorage.clear();

    document.documentElement.removeAttribute("data-accent");
  });

  it("renders all five accent options", async () => {
    render(
      <ThemeProvider>
        <AccentPicker />
      </ThemeProvider>,
    );

    expect(screen.getByText("Sky")).toBeInTheDocument();
    expect(screen.getByText("Teal")).toBeInTheDocument();
    expect(screen.getByText("Amber")).toBeInTheDocument();
    expect(screen.getByText("Rose")).toBeInTheDocument();
    expect(screen.getByText("Violet")).toBeInTheDocument();
  });

  it("highlights the selected accent", async () => {
    render(
      <ThemeProvider>
        <AccentPicker />
      </ThemeProvider>,
    );

    const skyButton = screen.getByRole("button", {
      name: /sky/i,
    });

    expect(skyButton).toHaveAttribute("aria-pressed", "true");
  });

  it("changes accent on click and persists to localStorage", async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <AccentPicker />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: /teal/i }));

    await waitFor(() => {
      expect(window.localStorage.getItem(ACCENT_STORAGE_KEY)).toBe("teal");
    });

    await waitFor(() => {
      expect(document.documentElement.dataset.accent).toBe("teal");
    });
  });

  it("updates aria-pressed when a different accent is selected", async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <AccentPicker />
      </ThemeProvider>,
    );

    const tealButton = screen.getByRole("button", { name: /teal/i });

    await user.click(tealButton);

    await waitFor(() => {
      expect(tealButton).toHaveAttribute("aria-pressed", "true");
    });

    const skyButton = screen.getByRole("button", { name: /sky/i });

    expect(skyButton).toHaveAttribute("aria-pressed", "false");
  });
});