import React from "react";

interface SkeletonProps {
  className?: string;
  height?: string;
}

export default function Skeleton({ className = "", height = "h-40" }: SkeletonProps) {
  return (
    <div
      className={`card border-white/10 bg-white/[0.03] animate-pulse flex flex-col justify-between p-6 ${height} ${className}`}
      role="status"
      aria-label="Loading content..."
    >
      <div>
        <div className="h-4 bg-white/10 rounded w-1/3 mb-4" />
        <div className="space-y-3">
          <div className="h-3 bg-white/10 rounded w-full" />
          <div className="h-3 bg-white/10 rounded w-5/6" />
        </div>
      </div>
      <div className="h-8 bg-white/10 rounded w-1/4 self-end mt-4" />
    </div>
  );
}
