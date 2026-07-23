import { useState, useEffect, useRef, useCallback } from "react";
import { isValidStellarAddress, isValidFederationAddress, resolveFederationAddress } from "@/lib/stellar";

interface ValidationState {
  resolvedAddress: string | null;
  isLoading: boolean;
  error: string | null;
}

export function useAddressValidation(value: string, debounceMs = 400): ValidationState {
  const [state, setState] = useState<ValidationState>({
    resolvedAddress: null,
    isLoading: false,
    error: null,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const validate = useCallback(async (input: string) => {
    if (!input.trim() || isValidStellarAddress(input.trim())) {
      setState({ resolvedAddress: null, isLoading: false, error: null });
      return;
    }

    if (!isValidFederationAddress(input.trim()) && !input.trim().includes("*")) {
      setState({ resolvedAddress: null, isLoading: false, error: null });
      return;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const resolved = await resolveFederationAddress(input.trim());
      setState({ resolvedAddress: resolved, isLoading: false, error: null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to resolve address";
      setState({ resolvedAddress: null, isLoading: false, error: msg });
    }
  }, []);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      validate(value);
    }, debounceMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [value, debounceMs, validate]);

  return state;
}

