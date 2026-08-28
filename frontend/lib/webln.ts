export interface WeblnPaymentRequest {
  destination: string;
  amount: string;
  memo?: string;
}

export interface WeblnPaymentResult {
  success: boolean;
  message: string;
}

declare global {
  interface Window {
    webln?: {
      enable: () => Promise<void>;
      sendPayment: (request: WeblnPaymentRequest) => Promise<{ success: boolean; message?: string }>;
    };
  }
}

export async function requestWeblnPayment(request: WeblnPaymentRequest): Promise<WeblnPaymentResult> {
  if (typeof window === "undefined") {
    return { success: false, message: "WebLN is only available in the browser." };
  }

  const provider = window.webln;
  if (!provider?.enable || !provider?.sendPayment) {
    return { success: false, message: "No WebLN provider was found." };
  }

  try {
    await provider.enable();
    const response = await provider.sendPayment(request);
    return {
      success: response?.success ?? false,
      message: response?.message || "Payment completed.",
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "WebLN payment failed.",
    };
  }
}
