import { useState, useCallback } from "react";
import { useAddressValidation } from "@/hooks/useAddressValidation";
import { isValidStellarAddress } from "@/lib/stellar";

interface AddressInputProps {
  value: string;
  onChange: (value: string) => void;
  onResolved?: (resolved: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export default function AddressInput({
  value,
  onChange,
  onResolved,
  placeholder = "Enter Stellar address or user*domain.com",
  className = "",
  disabled = false,
}: AddressInputProps) {
  const { resolvedAddress, isLoading, error } = useAddressValidation(value);
  const [lastResolved, setLastResolved] = useState<string | null>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange]
  );

  if (resolvedAddress && resolvedAddress !== lastResolved) {
    setLastResolved(resolvedAddress);
    onResolved?.(resolvedAddress);
  }

  const displayValue = lastResolved && value.includes("*") ? lastResolved : value;

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full rounded-lg border px-4 py-2 text-sm focus:outline-none focus:ring-2 ${
          error
            ? "border-red-500 focus:ring-red-500"
            : "border-gray-300 focus:ring-blue-500"
        } ${className}`}
      />
      {isLoading && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
          Resolving...
        </span>
      )}
      {resolvedAddress && !error && (
        <div className="mt-1 rounded bg-green-50 px-3 py-1 text-xs text-green-700">
          Resolved: {resolvedAddress}
        </div>
      )}
      {error && (
        <div className="mt-1 rounded bg-red-50 px-3 py-1 text-xs text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}

