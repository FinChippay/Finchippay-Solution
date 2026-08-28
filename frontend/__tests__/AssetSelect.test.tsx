import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import AssetSelect from "@/components/AssetSelect";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: jest.fn() },
  }),
}));

const options = [
  { code: "XLM", displayName: "XLM", isTrusted: true },
  { code: "USDC", displayName: "USDC", isTrusted: true },
  { code: "EURT", displayName: "EURT", issuer: "GAP5...", issuerHint: "tempo.eu.com", isTrusted: false },
];

describe("AssetSelect", () => {
  it("renders all options", () => {
    render(<AssetSelect options={options} selectedCode="XLM" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /XLM/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /USDC/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /EURT/ })).toBeInTheDocument();
  });

  it("shows an Add trustline action for untrusted assets when handler provided", () => {
    render(
      <AssetSelect
        options={options}
        selectedCode="XLM"
        onSelect={() => {}}
        onAddTrustline={() => {}}
      />
    );
    // EURT (untrusted) should have a "+ assetSelect.addTrustline" button
    expect(screen.getByText("+ assetSelect.addTrustline")).toBeInTheDocument();
  });

  it("does not show trustline action when no handler is provided", () => {
    render(<AssetSelect options={options} selectedCode="XLM" onSelect={() => {}} />);
    expect(screen.queryByText("+ assetSelect.addTrustline")).not.toBeInTheDocument();
  });

  it("calls onSelect with code when an option is clicked", () => {
    const onSelect = jest.fn();
    render(<AssetSelect options={options} selectedCode="XLM" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /USDC/ }));
    expect(onSelect).toHaveBeenCalledWith("USDC", undefined);
  });

  it("calls onAddTrustline with code and issuer", () => {
    const onAddTrustline = jest.fn();
    render(
      <AssetSelect
        options={options}
        selectedCode="XLM"
        onSelect={() => {}}
        onAddTrustline={onAddTrustline}
      />
    );
    fireEvent.click(screen.getByText("+ assetSelect.addTrustline"));
    expect(onAddTrustline).toHaveBeenCalledWith("EURT", "GAP5...");
  });

  it("renders fiat estimate when price and balance available", () => {
    const pricedOptions = [
      { code: "USDC", displayName: "USDC", isTrusted: true, balance: "10" },
    ];
    render(
      <AssetSelect
        options={pricedOptions}
        selectedCode="USDC"
        onSelect={() => {}}
        prices={{ USDC: 1 }}
      />
    );
    expect(screen.getByText(/~\$10\.00/)).toBeInTheDocument();
  });

  it("renders a no-assets message when empty", () => {
    render(<AssetSelect options={[]} selectedCode="" onSelect={() => {}} />);
    expect(screen.getByText(/noAssets/)).toBeInTheDocument();
  });
});
