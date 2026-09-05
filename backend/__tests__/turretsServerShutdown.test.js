"use strict";

jest.mock("../src/services/turretsService", () => ({
  startRunner: jest.fn(),
  stopRunner: jest.fn(),
}));

jest.mock("@sentry/node", () => ({
  init: jest.fn(),
  setupExpressErrorHandler: jest.fn(),
}));

const { stopRunner } = require("../src/services/turretsService");
const {
  createTurretsShutdownHandler,
  registerTurretsShutdown,
} = require("../src/turretsServer");

describe("turrets sidecar graceful shutdown", () => {
  let exitSpy;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it("stops the runner before closing the server", () => {
    const server = {
      close: jest.fn((callback) => callback()),
    };
    const shutdown = createTurretsShutdownHandler(server);

    shutdown("SIGTERM");

    expect(stopRunner).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(stopRunner.mock.invocationCallOrder[0]).toBeLessThan(
      server.close.mock.invocationCallOrder[0],
    );
  });

  it("registers SIGTERM and SIGINT handlers", () => {
    const onceSpy = jest.spyOn(process, "once").mockImplementation(() => {});

    registerTurretsShutdown({ close: jest.fn() });

    expect(onceSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    expect(onceSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
  });
});
