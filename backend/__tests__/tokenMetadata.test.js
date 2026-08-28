/* eslint-env jest */
const { getTokenMetadata } = require("../src/services/tokenMetadataService");

test("getTokenMetadata returns default shape for unknown contract", async () => {
  const contractId = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const meta = await getTokenMetadata(contractId);
  expect(meta).toHaveProperty("contractId", contractId);
  expect(meta).toHaveProperty("name", null);
  expect(meta).toHaveProperty("symbol", null);
  expect(meta).toHaveProperty("decimals", null);
});
