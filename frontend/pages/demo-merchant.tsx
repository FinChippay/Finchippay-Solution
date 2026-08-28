import React from "react";
import WeblnPaymentButton from "@/components/WeblnPaymentButton";

export default function DemoMerchantPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Demo merchant</h1>
      <p className="mt-3 text-slate-600">
        This page shows how a merchant can trigger a one-click Stellar payment with WebLN.
      </p>

      <div className="mt-8 rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-xl font-medium">Checkout</h2>
        <p className="mt-2 text-slate-600">Pay 1.25 XLM to the demo merchant wallet.</p>
        <div className="mt-4">
          <WeblnPaymentButton
            destination="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            amount="1.25"
            memo="Demo merchant"
          />
        </div>
      </div>
    </div>
  );
}
