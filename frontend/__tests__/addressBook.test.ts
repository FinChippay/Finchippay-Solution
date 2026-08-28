import { resolveFederationWithCache, getCachedFederationAddress, setCachedFederationAddress, clearFederationCache } from "@/lib/addressBook";

const VALID_ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA";

describe("resolveFederationWithCache", () => {
  beforeEach(() => {
    clearFederationCache();
  });

  it("returns null for an invalid federation address", async () => {
    const result = await resolveFederationWithCache("not_a_valid_federation");
    expect(result).toBeNull();
  });

  it("returns null for an unresolvable federation address", async () => {
    const result = await resolveFederationWithCache("nonexistent*stellar.org");
    expect(result).toBeNull();
  });

  it("caches resolved results", async () => {
    setCachedFederationAddress("bob*stellar.org", VALID_ADDRESS);
    const cached = getCachedFederationAddress("bob*stellar.org");
    expect(cached).toBe(VALID_ADDRESS);
  });
});

describe("federation cache", () => {
  beforeEach(() => {
    clearFederationCache();
  });

  it("returns null for uncached addresses", () => {
    expect(getCachedFederationAddress("unknown*test.org")).toBeNull();
  });

  it("stores and retrieves cached addresses", () => {
    setCachedFederationAddress("alice*example.com", VALID_ADDRESS);
    expect(getCachedFederationAddress("alice*example.com")).toBe(VALID_ADDRESS);
  });
});
