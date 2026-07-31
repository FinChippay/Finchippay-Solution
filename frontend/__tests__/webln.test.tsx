import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WeblnPaymentButton from "../components/WeblnPaymentButton";

jest.mock("../lib/webln", () => ({
  requestWeblnPayment: jest.fn().mockResolvedValue({ success: true, message: "Payment sent" }),
}));

import { requestWeblnPayment } from "../lib/webln";

describe("WeblnPaymentButton", () => {
  it("renders and triggers a WebLN payment request", async () => {
    const user = userEvent.setup();
    render(<WeblnPaymentButton destination="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" amount="1.25" memo="demo" />);

    await user.click(screen.getByRole("button", { name: /pay with stellar/i }));

    expect(requestWeblnPayment).toHaveBeenCalledWith({ destination: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", amount: "1.25", memo: "demo" });
    expect(await screen.findByText("Payment sent")).toBeInTheDocument();
  });
});
