"use client";
import { useEffect } from "react";
import { useToastContext } from "@/lib/ToastContext";
type QueueResult = { amount?: string; asset?: string; error?: string; success: boolean };
export default function QueueSyncNotifier() {
  const { addToast } = useToastContext();
  useEffect(() => {
    const show = (results: QueueResult[] = []) => results.forEach((result) => {
      const payment = result.amount ? `${result.amount} ${result.asset ?? "XLM"}` : "Payment";
      addToast(result.success ? `${payment} queued payment sent.` : `${payment} could not be sent: ${result.error ?? "Unknown error"}`, result.success ? "success" : "error");
    });
    const onResult = (event: Event) => show((event as CustomEvent<QueueResult[]>).detail);
    const onMessage = (event: MessageEvent) => { if (event.data?.type === "QUEUE_PROCESSED") show(event.data.results); };
    window.addEventListener("finchippay:queue-results", onResult);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => { window.removeEventListener("finchippay:queue-results", onResult); navigator.serviceWorker?.removeEventListener("message", onMessage); };
  }, [addToast]);
  return null;
}
