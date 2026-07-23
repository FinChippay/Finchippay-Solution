import { AssetInfo } from "@/lib/assetDiscovery";

interface TokenCardProps {
  asset: AssetInfo;
  onAddTrustline?: (code: string, issuer: string) => void;
}

export default function TokenCard({ asset, onAddTrustline }: TokenCardProps) {
  const truncatedIssuer = `${asset.issuer.slice(0, 8)}...${asset.issuer.slice(-4)}`;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center gap-3">
        {asset.image ? (
          <img src={asset.image} alt={asset.code} className="h-10 w-10 rounded-full" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
            {asset.code.slice(0, 2)}
          </div>
        )}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{asset.code}</span>
            {asset.isTrusted && (
              <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">
                Trusted
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500" title={asset.issuer}>
            {truncatedIssuer}
          </p>
          {asset.domain && (
            <p className="text-xs text-gray-400">{asset.domain}</p>
          )}
        </div>
        <div>
          {asset.isTrusted ? (
            <span className="text-sm text-gray-500">
              {asset.balance || "0"} {asset.code}
            </span>
          ) : (
            <button
              onClick={() => onAddTrustline?.(asset.code, asset.issuer)}
              className="rounded-lg bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
            >
              Add Trustline
            </button>
          )}
        </div>
      </div>
      {asset.description && (
        <p className="mt-2 text-xs text-gray-600">{asset.description}</p>
      )}
    </div>
  );
}
