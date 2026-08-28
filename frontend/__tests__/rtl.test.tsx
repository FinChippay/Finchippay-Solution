import { render } from "@testing-library/react";
import { getDirection, syncDocumentDirection, useDirection } from "@/lib/useDirection";

function DirectionProbe({ locale }: { locale: string }) {
  return <output data-direction={useDirection(locale)} />;
}

describe("RTL language support", () => {
  afterEach(() => syncDocumentDirection("en"));

  it.each(["ar", "ar-EG", "he", "he-IL", "fa", "ur"])(
    "uses RTL for %s",
    (locale) => expect(getDirection(locale)).toBe("rtl")
  );

  it("keeps non-RTL locales LTR", () => {
    expect(getDirection("en")).toBe("ltr");
    expect(getDirection("fr-CA")).toBe("ltr");
  });

  it("updates the document attributes with no page reload", () => {
    syncDocumentDirection("ar");
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
    expect(document.documentElement).toHaveAttribute("lang", "ar");

    syncDocumentDirection("en");
    expect(document.documentElement).toHaveAttribute("dir", "ltr");
    expect(document.documentElement).toHaveAttribute("lang", "en");
  });

  it("renders RTL direction for a key-page direction consumer", () => {
    const { getByRole, rerender } = render(<DirectionProbe locale="he" />);
    expect(getByRole("status")).toHaveAttribute("data-direction", "rtl");
    rerender(<DirectionProbe locale="en" />);
    expect(getByRole("status")).toHaveAttribute("data-direction", "ltr");
  });
});
