import { useState } from "react";

export interface Milestone {
  id: number;
  label: string;
  amount: string;
  deadline: number;
  status: "pending" | "approved" | "claimed";
}

interface MilestoneProgressProps {
  milestones: Milestone[];
}

function StatusIcon({ status }: { status: Milestone["status"] }) {
  switch (status) {
    case "claimed":
      return (
        <svg className="w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case "approved":
      return (
        <svg className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    default:
      return (
        <svg className="w-5 h-5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
  }
}

function StatusColor(status: Milestone["status"]): string {
  switch (status) {
    case "claimed": return "bg-emerald-500";
    case "approved": return "bg-blue-500";
    default: return "bg-slate-600";
  }
}

export default function MilestoneProgress({ milestones }: MilestoneProgressProps) {
  const [tooltipId, setTooltipId] = useState<number | null>(null);

  if (!milestones.length) return null;

  const completed = milestones.filter((m) => m.status === "claimed" || m.status === "approved").length;
  const total = milestones.length;
  const percentage = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div className="w-full">
      {/* Percentage bar */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-slate-400">Progress</span>
        <span className="text-xs font-medium text-slate-400">{Math.round(percentage)}%</span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-slate-700 mb-4">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500"
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Stepper */}
      <div className="relative flex items-start justify-between">
        {/* Connector line */}
        <div className="absolute top-2.5 left-0 right-0 h-0.5 bg-slate-700" />
        <div
          className="absolute top-2.5 left-0 h-0.5 bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500"
          style={{ width: `${percentage}%` }}
        />

        {milestones.map((milestone, index) => (
          <div
            key={milestone.id}
            className="relative flex flex-col items-center z-10"
            onMouseEnter={() => setTooltipId(milestone.id)}
            onMouseLeave={() => setTooltipId(null)}
          >
            {/* Step circle */}
            <div className={`w-5 h-5 rounded-full flex items-center justify-center ${StatusColor(milestone.status)} ring-2 ring-slate-900`}>
              <StatusIcon status={milestone.status} />
            </div>

            {/* Label */}
            <span className={`mt-2 text-[10px] font-medium text-center ${milestone.status === "pending" ? "text-slate-500" : "text-slate-300"}`}>
              {milestone.label}
            </span>

            {/* Tooltip */}
            {tooltipId === milestone.id && (
              <div className="absolute bottom-full mb-2 px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-xs text-slate-200 whitespace-nowrap shadow-xl z-20">
                <p className="font-medium mb-0.5">{milestone.label}</p>
                <p className="text-slate-400">Amount: {milestone.amount} XLM</p>
                <p className="text-slate-400">Deadline: ledger {milestone.deadline.toLocaleString()}</p>
                <p className="text-slate-400 capitalize">Status: {milestone.status}</p>
                {/* Arrow */}
                <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-800 border-r border-b border-slate-600 rotate-45 -mt-1" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
