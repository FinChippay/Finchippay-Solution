import { ThemeProvider } from "@/lib/ThemeContext";
import ThemeSettings from "@/components/ThemeSettings";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const THEME_STORAGE_KEY = "finchippay:theme";
const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";

function installMatchMedia() {
  const mediaQueryList: MediaQueryList = {
    matches: false,
    media: DARK_MODE_QUERY,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(() => true),
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: jest.fn(() => mediaQueryList),
  });
}

describe("ThemeSettings", () => {
  beforeEach(() => {
    installMatchMedia();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-accent");
    document.documentElement.removeAttribute("data-font-size");
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-accent");
    document.documentElement.removeAttribute("data-font-size");
  });

  it("renders all theme mode options", () => {
    render(
      <ThemeProvider>
        <ThemeSettings />
      </ThemeProvider>,
    );
    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("Dark")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
  });

  it("renders accent colour swatches", () => {
    render(
      <ThemeProvider>
        <ThemeSettings />
      </ThemeProvider>,
    );
    expect(screen.getByTitle("Stellar")).toBeInTheDocument();
    expect(screen.getByTitle("Emerald")).toBeInTheDocument();
    expect(screen.getByTitle("Violet")).toBeInTheDocument();
    expect(screen.getByTitle("Amber")).toBeInTheDocument();
    expect(screen.getByTitle("Rose")).toBeInTheDocument();
    expect(screen.getByTitle("Teal")).toBeInTheDocument();
    expect(screen.getByTitle("Indigo")).toBeInTheDocument();
    expect(screen.getByTitle("Slate")).toBeInTheDocument();
  });

  it("renders font size options", () => {
    render(
      <ThemeProvider>
        <ThemeSettings />
      </ThemeProvider>,
    );
    expect(screen.getByText("Small")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("Large")).toBeInTheDocument();
  });

  it("changes accent colour on click", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeSettings />
      </ThemeProvider>,
    );
    await user.click(screen.getByTitle("Emerald"));
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) || "{}");
      expect(stored.accent).toBe("emerald");
      expect(document.documentElement.dataset.accent).toBe("emerald");
    });
  });

  it("changes font size on click", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeSettings />
      </ThemeProvider>,
    );
    await user.click(screen.getByText("Large"));
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) || "{}");
      expect(stored.fontSize).toBe("large");
      expect(document.documentElement.dataset.fontSize).toBe("large");
    });
  });

  it("toggles high contrast mode", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeSettings />
      </ThemeProvider>,
    );
    const toggle = screen.getByRole("switch");
    expect(toggle).toBeInTheDocument();
    await user.click(toggle);
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) || "{}");
      expect(stored.highContrast).toBe(true);
    });
  });

  it("resets to defaults on button click", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ mode: "dark", accent: "rose", fontSize: "small", highContrast: true }),
    );
    render(
      <ThemeProvider>
        <ThemeSettings />
      </ThemeProvider>,
    );
    await user.click(screen.getByText("Reset to Defaults"));
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) || "{}");
      expect(stored.mode).toBe("system");
      expect(stored.accent).toBe("stellar");
      expect(stored.fontSize).toBe("medium");
      expect(stored.highContrast).toBe(false);
    });
  });
});
