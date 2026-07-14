import { copyToClipboard } from "@/utils/format";

describe("copyToClipboard (#275)", () => {
  const originalClipboard = navigator.clipboard;

  // jsdom does not implement execCommand, so it must be defined before spying.
  const originalExec = (document as unknown as { execCommand?: unknown }).execCommand;

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
    });
    (document as unknown as { execCommand?: unknown }).execCommand = originalExec;
    jest.restoreAllMocks();
  });

  function setExecCommand(result: boolean) {
    (document as unknown as { execCommand: unknown }).execCommand = jest
      .fn()
      .mockReturnValue(result);
    return (document as unknown as { execCommand: jest.Mock }).execCommand;
  }

  function setClipboard(value: unknown) {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value });
  }

  it("uses the Clipboard API in secure contexts", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    await expect(copyToClipboard("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when navigator.clipboard is unavailable (HTTP)", async () => {
    setClipboard(undefined);
    const exec = setExecCommand(true);
    await expect(copyToClipboard("hi")).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("returns false when both the Clipboard API and execCommand fail", async () => {
    setClipboard({ writeText: jest.fn().mockRejectedValue(new Error("denied")) });
    setExecCommand(false);
    await expect(copyToClipboard("x")).resolves.toBe(false);
  });
});
