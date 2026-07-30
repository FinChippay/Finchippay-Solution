import type { Meta, StoryObj } from "@storybook/react";
import ThemeSettings from "../components/ThemeSettings";

const meta: Meta<typeof ThemeSettings> = {
  title: "Components/ThemeSettings",
  component: ThemeSettings,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Full theme customisation panel with mode selector, accent colour picker, font size selector, and high-contrast toggle.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-lg">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-cosmos-800">
          <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">Appearance</h2>
          <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">Customise your theme, accent colours, and font size.</p>
          <Story />
        </div>
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
