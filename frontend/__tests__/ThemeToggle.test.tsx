import { useTheme } from "@/lib/ThemeContext";
import { ThemeProvider } from "@/lib/ThemeContext";
import ThemeToggle from "@/components/ThemeToggle";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const THEME_STORAGE_KEY = "finchippay:theme";
const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";

type MediaQueryChangeListener = (event: MediaQueryListEvent) => void;

interface MatchMediaController {
  setMatches: (matches: boolean) => void;
}

function installMatchMedia(initialMatches: boolean): MatchMediaController {
  let currentMatches = initialMatches;

  const listeners = new Set<MediaQueryChangeListener>();

  const mediaQueryList: MediaQueryList = {
    get matches() {
      return currentMatches;
    },

    media: DARK_MODE_QUERY,
    onchange: null,

    addListener: jest.fn((listener: MediaQueryChangeListener) => {
      listeners.add(listener);
    }),

    removeListener: jest.fn((listener: MediaQueryChangeListener) => {
      listeners.delete(listener);
    }),

    addEventListener: jest.fn(
      (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === "change" && typeof listener === "function") {
          listeners.add(listener as MediaQueryChangeListener);
        }
      },
    ),

    removeEventListener: jest.fn(
      (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === "change" && typeof listener === "function") {
          listeners.delete(listener as MediaQueryChangeListener);
        }
      },
    ),

    dispatchEvent: jest.fn(() => true),
  };

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: jest.fn((query: string) => {
      if (query !== DARK_MODE_QUERY) {
        throw new Error(`Unexpected media query: ${query}`);
      }

      return mediaQueryList;
    }),
  });

  return {
    setMatches(nextMatches: boolean) {
      currentMatches = nextMatches;

      const event = new Event("change") as MediaQueryListEvent;

      Object.defineProperties(event, {
        matches: {
          configurable: true,
          value: nextMatches,
        },

        media: {
          configurable: true,
          value: DARK_MODE_QUERY,
        },
      });

      listeners.forEach((listener) => {
        listener(event);
      });
    },
  };
}

function ThemeStatePreview() {
  const { theme, resolved, setTheme } = useTheme();

  return (
    <div>
      <span data-testid="selected-theme">{theme}</span>

      <span data-testid="resolved-theme">{resolved}</span>

      <button type="button" onClick={() => setTheme("light")}>
        Select light
      </button>

      <button type="button" onClick={() => setTheme("dark")}>
        Select dark
      </button>

      <button type="button" onClick={() => setTheme("system")}>
        Select system
      </button>
    </div>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();

    document.documentElement.classList.remove("dark");

    document.documentElement.removeAttribute("data-theme");

    document.documentElement.style.colorScheme = "";

    installMatchMedia(false);
  });

  afterEach(() => {
    window.localStorage.clear();

    document.documentElement.classList.remove("dark");

    document.documentElement.removeAttribute("data-theme");

    document.documentElement.style.colorScheme = "";
  });

  it("uses the saved preference from localStorage", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    render(
      <ThemeProvider>
        <ThemeStatePreview />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("selected-theme")).toHaveTextContent("dark");

      expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");

      expect(document.documentElement).toHaveClass("dark");
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("persists a manually selected theme", async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <ThemeStatePreview />
      </ThemeProvider>,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Select dark",
      }),
    );

    await waitFor(() => {
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

      expect(document.documentElement).toHaveClass("dark");

      expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
    });

    await user.click(
      screen.getByRole("button", {
        name: "Select light",
      }),
    );

    await waitFor(() => {
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

      expect(document.documentElement).not.toHaveClass("dark");

      expect(screen.getByTestId("resolved-theme")).toHaveTextContent("light");
    });
  });

  it("updates in real time when system preference changes", async () => {
    const matchMedia = installMatchMedia(false);

    render(
      <ThemeProvider>
        <ThemeStatePreview />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("selected-theme")).toHaveTextContent("system");

      expect(screen.getByTestId("resolved-theme")).toHaveTextContent("light");

      expect(document.documentElement).not.toHaveClass("dark");
    });

    act(() => {
      matchMedia.setMatches(true);
    });

    await waitFor(() => {
      expect(screen.getByTestId("selected-theme")).toHaveTextContent("system");

      expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");

      expect(document.documentElement).toHaveClass("dark");
    });

    act(() => {
      matchMedia.setMatches(false);
    });

    await waitFor(() => {
      expect(screen.getByTestId("resolved-theme")).toHaveTextContent("light");

      expect(document.documentElement).not.toHaveClass("dark");
    });
  });

  it("falls back to system when storage contains an invalid value", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "unsupported-theme");

    render(
      <ThemeProvider>
        <ThemeStatePreview />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("selected-theme")).toHaveTextContent("system");

      expect(screen.getByTestId("resolved-theme")).toHaveTextContent("light");
    });
  });
});

describe("ThemeToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();

    document.documentElement.classList.remove("dark");

    document.documentElement.removeAttribute("data-theme");

    document.documentElement.style.colorScheme = "";

    installMatchMedia(false);
  });

  afterEach(() => {
    window.localStorage.clear();

    document.documentElement.classList.remove("dark");

    document.documentElement.removeAttribute("data-theme");

    document.documentElement.style.colorScheme = "";
  });

  it("shows light, dark and system options", async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    const toggleButton = await screen.findByRole("button", {
      name: /change theme/i,
    });

    await user.click(toggleButton);

    expect(
      screen.getByRole("menu", {
        name: "Theme options",
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("menuitemradio", {
        name: /light/i,
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("menuitemradio", {
        name: /dark/i,
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("menuitemradio", {
        name: /system/i,
      }),
    ).toBeInTheDocument();
  });

  it("selects and persists dark mode", async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    await user.click(
      await screen.findByRole("button", {
        name: /change theme/i,
      }),
    );

    await user.click(
      screen.getByRole("menuitemradio", {
        name: /dark/i,
      }),
    );

    await waitFor(() => {
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

      expect(document.documentElement).toHaveClass("dark");
    });

    expect(
      screen.queryByRole("menu", {
        name: "Theme options",
      }),
    ).not.toBeInTheDocument();
  });

  it("closes the menu when Escape is pressed", async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    await user.click(
      await screen.findByRole("button", {
        name: /change theme/i,
      }),
    );

    expect(
      screen.getByRole("menu", {
        name: "Theme options",
      }),
    ).toBeInTheDocument();

    fireEvent.keyDown(document, {
      key: "Escape",
    });

    expect(
      screen.queryByRole("menu", {
        name: "Theme options",
      }),
    ).not.toBeInTheDocument();
  });
});
