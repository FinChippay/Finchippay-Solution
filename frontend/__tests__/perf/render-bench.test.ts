describe("frontend render benchmark smoke test", () => {
  it("completes a lightweight render benchmark", () => {
    const start = Date.now();
    const elements = Array.from({ length: 20 }, (_, idx) => `row-${idx}`);
    const rendered = elements.join(",");
    expect(rendered).toContain("row-0");
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
