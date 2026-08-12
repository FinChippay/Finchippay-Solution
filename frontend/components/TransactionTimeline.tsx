/**
 * components/TransactionTimeline.tsx
 * Visual timeline for transaction status progression
 */

import clsx from "clsx";
import { motion } from "framer-motion";
import { CheckIcon } from "@/components/icons";
import { formatDate } from "@/utils/format";

export interface TimelineStep {
  label: string;
  timestamp?: string;
  status: "completed" | "current" | "pending";
}

interface TransactionTimelineProps {
  steps: TimelineStep[];
}

export default function TransactionTimeline({ steps }: TransactionTimelineProps) {
  return (
    <div className="space-y-4">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const isCompleted = step.status === "completed";
        const isCurrent = step.status === "current";

        return (
          <div key={index} className="flex gap-4">
            {/* Timeline indicator */}
            <div className="flex flex-col items-center flex-shrink-0">
              {/* Circle */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: index * 0.1, duration: 0.3 }}
                className={clsx(
                  "w-8 h-8 rounded-full flex items-center justify-center relative z-10",
                  isCompleted && "bg-emerald-500/20 border-2 border-emerald-500",
                  isCurrent && "bg-stellar-500/20 border-2 border-stellar-500",
                  step.status === "pending" && "bg-slate-200 dark:bg-slate-700 border-2 border-slate-300 dark:border-slate-600"
                )}
              >
                {isCompleted && (
                  <CheckIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                )}
                {isCurrent && (
                  <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                    className="w-3 h-3 rounded-full bg-stellar-500"
                  />
                )}
                {step.status === "pending" && (
                  <div className="w-3 h-3 rounded-full bg-slate-400 dark:bg-slate-600" />
                )}
              </motion.div>

              {/* Vertical line */}
              {!isLast && (
                <div
                  className={clsx(
                    "w-0.5 h-12 mt-1",
                    isCompleted ? "bg-emerald-500" : "bg-slate-200 dark:bg-slate-700"
                  )}
                />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 pb-8">
              <h3
                className={clsx(
                  "font-semibold text-sm mb-1",
                  isCompleted && "text-slate-900 dark:text-white",
                  isCurrent && "text-stellar-600 dark:text-stellar-400",
                  step.status === "pending" && "text-slate-500 dark:text-slate-400"
                )}
              >
                {step.label}
              </h3>
              {step.timestamp && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {formatDate(step.timestamp)}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}