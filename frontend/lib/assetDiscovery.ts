import { Asset, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { server, NETWORK_PASSPHRASE } from "./stellar";

export interface AssetInfo {
  code: string;
  issuer: string;
  domain?: string;
  image?: string;
  description?: string;
  isTrusted: boolean;
  balance?: string;
}

const KNOWN_ASSETS: { code: string; issuer: string; domain: string }[] = [
  { code: "USDC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", domain: "centre.io" },
  { code: "EURT", issuer: "GAP5LETOV6YIE62YAM56STDANPRDO7ZFDBGSNHJQIYGGKSMOZAHOOS2S", domain: "tempo.eu.com" },
  { code: "BTC", issuer: "GDPKQ2TSNJOFSEE5XTCNS3LUB4LUB2F6F5F6JF7FVKKDJFJFRH7DS4MP", domain: "apay.io" },
  { code: "ETH", issuer: "GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR", domain: "apay.io" },
  { code: "NGNT", issuer: "GAWODAROMJ33V5YDFY3NPYTHVYQG7MJXVJ2ND3AOGIHYRWINES6ACCPD", domain: "cowrie.exchange" },
];

export async function getKnownAssets(
  publicKey: string,
  trustedAssets: { code: string; issuer: string; balance: string }[] = []
): Promise<AssetInfo[]> {
  const results: AssetInfo[] = [];

  for (const asset of KNOWN_ASSETS) {
    const trusted = trustedAssets.find(
      (a) => a.code === asset.code && a.issuer === asset.issuer
    );

    let image: string | undefined;
    let description: string | undefined;

    try {
      const tomlUrl = `https://${asset.domain}/.well-known/stellar.toml`;
      const res = await fetch(tomlUrl);
      if (res.ok) {
        const text = await res.text();
        const imgMatch = text.match(/^IMAGE\s*=\s*"(.+)"/m);
        const descMatch = text.match(/^DESCRIPTION\s*=\s*"(.+)"/m);
        if (imgMatch) image = imgMatch[1];
        if (descMatch) description = descMatch[1];
      }
    } catch {
      // TOML fetch failed, use defaults
    }

    results.push({
      code: asset.code,
      issuer: asset.issuer,
      domain: asset.domain,
      image,
      description,
      isTrusted: !!trusted,
      balance: trusted?.balance,
    });
  }

  return results;
}

export async function buildAddTrustlineTx(
  publicKey: string,
  assetCode: string,
  assetIssuer: string
): Promise<string> {
  const sourceAccount = await server.loadAccount(publicKey);
  const asset = new Asset(assetCode, assetIssuer);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.changeTrust({
        asset,
      })
    )
    .setTimeout(30)
    .build();

  return tx.toXDR();
}
