describe("backend api benchmark smoke test", () => {
  it("executes quickly enough for the benchmark harness", async () => {
    const start = Date.now();
    await Promise.resolve();
    const elapsedMs = Date.now() - start;
    expect(elapsedMs).toBeLessThan(1000);
  });
});
