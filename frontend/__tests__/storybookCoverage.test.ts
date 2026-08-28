import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const storyFiles = [
  "MultiSigFlow.stories.tsx",
  "BatchPaymentForm.stories.tsx",
  "RecurringPayments.stories.tsx",
  "EscrowPage.stories.tsx",
  "AIPaymentAssistant.stories.tsx",
  "TipWidget.stories.tsx",
  "PaymentStatusModal.stories.tsx",
];

describe("Storybook component coverage", () => {
  it.each(storyFiles)("documents all required states in %s", (fileName) => {
    const storyPath = resolve(process.cwd(), "stories", fileName);

    expect(existsSync(storyPath)).toBe(true);

    const source = readFileSync(storyPath, "utf8");
    expect(source).toMatch(/export const Default\b/);
    expect(source).toMatch(/export const Loading\b/);
    expect(source).toMatch(/export const Error\b/);
    expect(source).toMatch(/export const Mobile\b/);
    expect(source).toMatch(/defaultViewport:\s*["']mobile1["']/);
    expect(source).not.toContain("mocked(");
  });

  it("documents the Tailwind design-token categories", () => {
    const docsPath = resolve(process.cwd(), "stories", "DesignTokens.mdx");
    const storybookConfigPath = resolve(process.cwd(), ".storybook", "main.ts");

    expect(existsSync(docsPath)).toBe(true);

    const source = readFileSync(docsPath, "utf8");
    const storybookConfig = readFileSync(storybookConfigPath, "utf8");
    expect(source).toContain("# Design Tokens");
    expect(source).toContain("## Colors");
    expect(source).toContain("## Spacing");
    expect(source).toContain("## Typography");
    expect(storybookConfig).toContain('"../stories/**/*.mdx"');
  });

  it("builds Storybook and runs Chromatic in CI", () => {
    const workflowPath = resolve(process.cwd(), "..", ".github", "workflows", "ci.yml");
    const source = readFileSync(workflowPath, "utf8");

    expect(source).toContain("npm run build-storybook");
    expect(source).toContain("chromaui/action@");
    expect(source).toContain("CHROMATIC_PROJECT_TOKEN");
  });
});
