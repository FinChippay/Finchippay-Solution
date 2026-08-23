import { useTheme, ThemeProvider, type Accent } from "@/lib/ThemeContext";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const ACCENT_STORAGE_KEY = "finchippay:accent";

function AccentPreview() {
  const { accent, setAccent } = useTheme();

  return (
    <div>
      <span data-testid="selected-accent">{accent}</span>
      <button type="button" onClick={() => setAccent("teal")}>
        Select teal
      </button>
      <button type="button" onClick={() => setAccent("amber")}>
        Select amber
      </button>
    </div>
  );
}

describe("ThemeProvider accent support (Issue #46)", () => {
  beforeEach(() => {
    window.localStorage.clear();

    document.documentElement.removeAttribute("data-accent");
  });

  afterEach(() => {
    window.localStorage.clear();

    document.documentElement.removeAttribute("data-accent");
  });

  it("defaults to the stellar accent", async () => {
    render(
      <ThemeProvider>
        <AccentPreview />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("selected-accent")).toHaveTextContent(
        "stellar",
      );
    });

    expect(document.documentElement.dataset.accent).toBe("stellar");
  });

  it("applies the saved accent from localStorage on mount", async () => {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, "rose");

    render(
      <ThemeProvider>
        <AccentPreview />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("selected-accent")).toHaveTextContent("rose");
    });

    expect(document.documentElement.dataset.accent).toBe("rose");
  });

  it("persists a manually selected accent", async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <AccentPreview />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Select teal" }));

    await waitFor(() => {
      expect(window.localStorage.getItem(ACCENT_STORAGE_KEY)).toBe("teal");

      expect(document.documentElement.dataset.accent).toBe("teal");

      expect(screen.getByTestId("selected-accent")).toHaveTextContent("teal");
    });
  });

  it("switches accents at runtime and updates the DOM", async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <AccentPreview />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Select amber" }));

    await waitFor(() => {
      expect(document.documentElement.dataset.accent).toBe("amber");
    });
  });

  it("falls back to stellar when storage contains an invalid value", async () => {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, "unsupported-accent");

    render(
      <ThemeProvider>
        <AccentPreview />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("selected-accent")).toHaveTextContent(
        "stellar",
      );
    });

    expect(document.documentElement.dataset.accent).toBe("stellar");
  });

  it("exposes all five accent presets", () => {
    const accents: Accent[] = [
      "stellar",
      "teal",
      "amber",
      "rose",
      "violet",
    ];

    expect(accents).toHaveLength(5);
  });
});