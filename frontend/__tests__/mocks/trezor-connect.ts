/**
 * __tests__/mocks/trezor-connect.ts
 * Standalone mock of @trezor/connect used via jest moduleNameMapper.
 * Tests rewire the behaviour through the exported mocks.
 */

export const mockInit = jest.fn(async () => undefined);
export const mockDispose = jest.fn(async () => undefined);
export const mockStellarGetPublicKey = jest.fn();
export const mockStellarSignTransaction = jest.fn();

const trezorConnectMock = {
  init: mockInit,
  dispose: mockDispose,
  stellarGetPublicKey: mockStellarGetPublicKey,
  stellarSignTransaction: mockStellarSignTransaction,
};

export default trezorConnectMock;