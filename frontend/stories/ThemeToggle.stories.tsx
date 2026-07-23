import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import ThemeToggle from "../components/ThemeToggle";
import { useTheme, type Theme } from "../lib/ThemeContext";

interface ThemeTogglePreviewProps {
  initialTheme: Theme;
}

function ThemeTogglePreview({ initialTheme }: ThemeTogglePreviewProps) {
  const { theme, resolved, setTheme } = useTheme();

  useEffect(() => {
    setTheme(initialTheme);
  }, [initialTheme, setTheme]);

  return (
    <div className="min-h-[280px] bg-slate-50 p-8 text-slate-900 transition-colors duration-300 dark:bg-cosmos-900 dark:text-white">
      <div className="mx-auto max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-lg transition-colors duration-300 dark:border-slate-700 dark:bg-cosmos-800">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              Appearance
            </h2>

            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Select a light, dark or system-controlled theme.
            </p>
          </div>

          <ThemeToggle />
        </div>

        <dl className="mt-6 space-y-3 border-t border-slate-200 pt-4 text-sm dark:border-slate-700">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-slate-600 dark:text-slate-400">
              Selected preference
            </dt>

            <dd className="font-mono font-medium capitalize text-slate-900 dark:text-white">
              {theme}
            </dd>
          </div>

          <div className="flex items-center justify-between gap-4">
            <dt className="text-slate-600 dark:text-slate-400">
              Resolved appearance
            </dt>

            <dd className="font-mono font-medium capitalize text-slate-900 dark:text-white">
              {resolved}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

const meta: Meta<typeof ThemeToggle> = {
  title: "Components/ThemeToggle",
  component: ThemeToggle,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Accessible theme selector supporting persistent light, dark and operating-system preferences.",
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Light: Story = {
  render: () => <ThemeTogglePreview initialTheme="light" />,
  parameters: {
    backgrounds: {
      default: "light",
    },
  },
};

export const Dark: Story = {
  render: () => <ThemeTogglePreview initialTheme="dark" />,
  parameters: {
    backgrounds: {
      default: "dark",
    },
  },
};

export const System: Story = {
  render: () => <ThemeTogglePreview initialTheme="system" />,
  parameters: {
    backgrounds: {
      default: "light",
    },
  },
};
