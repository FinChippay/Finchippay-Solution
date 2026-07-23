import { lazy, Suspense } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "@storybook/test";
import RecurringPayments, { type RecurringSchedule } from "../components/RecurringPayments";

const STORAGE_KEY = "finchippay:recurring-schedules";
const RECIPIENT = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const schedules: RecurringSchedule[] = [
  {
    id: "monthly-design-retainer",
    recipient: RECIPIENT,
    amount: "15",
    memo: "Design retainer",
    frequency: "monthly",
    startDate: "2099-08-01",
    nextDueDate: "2099-08-01",
    createdAt: 1,
  },
];

const DeferredRecurringPayments = lazy(
  () => new Promise<{ default: typeof RecurringPayments }>(() => undefined)
);

const meta = {
  title: "Components/RecurringPayments",
  component: RecurringPayments,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Creates and manages weekly or monthly payment reminders stored in the browser, with due-payment shortcuts back into the send flow.",
      },
    },
  },
  args: {
    onPayNow: fn(),
  },
} satisfies Meta<typeof RecurringPayments>;

export default meta;
type Story = StoryObj<typeof meta>;

function seedSchedules() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(schedules));
  return () => window.localStorage.removeItem(STORAGE_KEY);
}

function clearSchedules() {
  window.localStorage.removeItem(STORAGE_KEY);
}

export const Default: Story = {
  beforeEach: seedSchedules,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("15 XLM")).toBeInTheDocument();
    await expect(canvas.getByText("Design retainer")).toBeInTheDocument();
  },
};

export const Loading: Story = {
  render: (args) => (
    <Suspense
      fallback={
        <div className="card min-w-80" role="status" aria-label="Loading recurring payments">
          <div className="flex items-center gap-3">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-stellar-400 border-t-transparent" />
            <div>
              <p className="font-display font-semibold text-white">Recurring Payments</p>
              <p className="mt-1 text-sm text-slate-400">Loading saved schedules…</p>
            </div>
          </div>
        </div>
      }
    >
      <DeferredRecurringPayments {...args} />
    </Suspense>
  ),
};

export const Error: Story = {
  beforeEach: clearSchedules,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "+ New schedule" }));
    await userEvent.click(canvas.getByRole("button", { name: "Create" }));
    await expect(canvas.getByText("Recipient is required.")).toBeInTheDocument();
  },
};

export const Mobile: Story = {
  beforeEach: seedSchedules,
  parameters: {
    viewport: { defaultViewport: "mobile1" },
    layout: "fullscreen",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("15 XLM")).toBeInTheDocument();
  },
};
