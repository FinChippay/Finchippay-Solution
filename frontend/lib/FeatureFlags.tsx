import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface FeatureFlagDefinition {
  enabled: boolean;
  rollout: number;
}

export interface FeatureFlagsMap {
  [key: string]: boolean;
}

const DEFAULT_FEATURE_FLAGS: Record<string, FeatureFlagDefinition> = {
  streaming_payments: { enabled: true, rollout: 100 },
  ai_payment_assistant: { enabled: true, rollout: 50 },
  multi_sig_payments: { enabled: true, rollout: 100 },
  new_dashboard_charts: { enabled: false, rollout: 0 },
  trading_page: { enabled: true, rollout: 100 },
  ledger_wallet: { enabled: false, rollout: 0 },
};

function hashUser(flagName: string, userPublicKey: string): number {
  let hash = 0;
  const str = `${flagName}:${userPublicKey}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

function resolveFlags(userPublicKey: string | null): FeatureFlagsMap {
  const overrides: Record<string, FeatureFlagDefinition> = {};
  if (typeof window !== "undefined") {
    const raw = process.env.NEXT_PUBLIC_FEATURE_FLAGS || "{}";
    try {
      const parsed = JSON.parse(raw);
      for (const key of Object.keys(parsed)) {
        if (typeof parsed[key] === "object") {
          overrides[key] = parsed[key];
        } else {
          overrides[key] = { enabled: !!parsed[key], rollout: parsed[key] ? 100 : 0 };
        }
      }
    } catch {}
  }

  const result: FeatureFlagsMap = {};
  const allKeys = new Set([...Object.keys(DEFAULT_FEATURE_FLAGS), ...Object.keys(overrides)]);
  for (const key of allKeys) {
    const def = overrides[key] || DEFAULT_FEATURE_FLAGS[key];
    if (!def) {
      result[key] = false;
      continue;
    }
    if (!def.enabled) {
      result[key] = false;
      continue;
    }
    if (def.rollout >= 100) {
      result[key] = true;
      continue;
    }
    if (def.rollout <= 0 || !userPublicKey) {
      result[key] = false;
      continue;
    }
    const bucket = hashUser(key, userPublicKey) % 100;
    result[key] = bucket < def.rollout;
  }
  return result;
}

const FeatureFlagsContext = createContext<FeatureFlagsMap>({});

export function FeatureFlagProvider({ children, publicKey }: { children: ReactNode; publicKey: string | null }) {
  const [serverFlags, setServerFlags] = useState<FeatureFlagsMap | null>(null);

  useEffect(() => {
    if (!publicKey) {
      setServerFlags(null);
      return;
    }
    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
    fetch(`${apiBase}/api/v1/features`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch features");
        return res.json();
      })
      .then((data) => {
        if (data.features) {
          setServerFlags(data.features);
        }
      })
      .catch(() => {});
  }, [publicKey]);

  const flags = useMemo(() => {
    if (serverFlags) {
      const merged: FeatureFlagsMap = {};
      const local = resolveFlags(publicKey);
      for (const key of Object.keys(local)) {
        merged[key] = serverFlags[key] !== undefined ? serverFlags[key] : local[key];
      }
      return merged;
    }
    return resolveFlags(publicKey);
  }, [publicKey, serverFlags]);

  return (
    <FeatureFlagsContext.Provider value={flags}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFeatureFlag(name: string): boolean {
  const flags = useContext(FeatureFlagsContext);
  return flags[name] ?? false;
}

export function FeatureGate({ flag, children, fallback }: { flag: string; children: ReactNode; fallback?: ReactNode }) {
  const enabled = useFeatureFlag(flag);
  if (enabled) return <>{children}</>;
  if (fallback) return <>{fallback}</>;
  return null;
}
