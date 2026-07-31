import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import ReceiptCard from '../components/ReceiptCard';

const meta: Meta<typeof ReceiptCard> = {
  title: 'Components/ReceiptCard',
  component: ReceiptCard,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    onViewDetails: { action: 'view details clicked' },
  },
};

export default meta;
type Story = StoryObj<typeof ReceiptCard>;

const defaultReceipt = {
  from: 'GBXXABC1234567890ABCDEF1234567890ABCDEF',
  to: 'GAYYXYZ0987654321XYZABCD0987654321XYZABCD',
  amount: '1500000000', // 150 XLM
  timestamp: Math.floor(Date.now() / 1000),
  memo: 'Dinner share',
  ledger: 456789,
};

export const Default: Story = {
  args: {
    index: 1,
    receipt: defaultReceipt,
  },
  decorators: [
    (Story) => (
      <div className="w-[350px]">
        <Story />
      </div>
    ),
  ],
};

export const NoMemo: Story = {
  args: {
    index: 2,
    receipt: {
      ...defaultReceipt,
      memo: '',
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[350px]">
        <Story />
      </div>
    ),
  ],
};

export const LongMemo: Story = {
  args: {
    index: 3,
    receipt: {
      ...defaultReceipt,
      memo: 'This is a very long memo that should probably truncate gracefully',
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[350px]">
        <Story />
      </div>
    ),
  ],
};
