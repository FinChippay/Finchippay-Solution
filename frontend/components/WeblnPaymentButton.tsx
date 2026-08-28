import React, { useState } from "react";
import { requestWeblnPayment } from "@/lib/webln";

interface WeblnPaymentButtonProps {
  destination: string;
  amount: string;
  memo?: string;
  label?: string;
}

export default function WeblnPaymentButton({
  destination,
  amount,
  memo,
  label = "Pay with Stellar",
}: WeblnPaymentButtonProps) {
  const [status, setStatus] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  const onPay = async () => {
    setIsLoading(true);
    setStatus("");
    const result = await requestWeblnPayment({ destination, amount, memo });
    setStatus(result.message);
    setIsLoading(false);
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onPay}
        disabled={isLoading || !destination || !amount}
        className="btn-primary px-4 py-2"
      >
        {isLoading ? "Connecting..." : label}
      </button>
      {status ? <p className="text-sm text-slate-600">{status}</p> : null}
    </div>
  );
}
