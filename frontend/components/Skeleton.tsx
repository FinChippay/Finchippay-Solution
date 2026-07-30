import React from "react";

interface SkeletonProps {
  className?: string;
  height?: string;
  width?: string;
  variant?: "card" | "chart" | "stat" | "text" | "circle";
}

export default function Skeleton({
  className = "",
  height = "h-40",
  width,
  variant = "card",
}: SkeletonProps) {
  if (variant === "circle") {
    return (
      <div
        className={`rounded-full bg-white/10 animate-pulse ${height} ${width ?? height} ${className}`.trim()}
        role="status"
        aria-label="Loading..."
      />
    );
  }

  if (variant === "text") {
    return (
      <div
        className={`h-4 bg-white/10 rounded animate-pulse ${width ?? "w-full"} ${className}`.trim()}
        role="status"
        aria-label="Loading text..."
      />
    );
  }

  if (variant === "chart") {
    return (
      <div
        className={`card border-white/10 bg-white/[0.03] animate-pulse flex flex-col justify-between p-6 ${height} ${width ?? "w-full"} ${className}`.trim()}
        role="status"
        aria-label="Loading chart..."
      >
        <div className="flex justify-between items-center mb-4">
          <div className="h-5 bg-white/10 rounded w-1/4" />
          <div className="h-4 bg-white/10 rounded w-1/6" />
        </div>
        <div className="flex items-end justify-between space-x-2 h-48 pt-4">
          <div className="h-1/3 bg-white/10 rounded w-full" />
          <div className="h-2/3 bg-white/10 rounded w-full" />
          <div className="h-1/2 bg-white/10 rounded w-full" />
          <div className="h-5/6 bg-white/10 rounded w-full" />
          <div className="h-2/5 bg-white/10 rounded w-full" />
        </div>
      </div>
    );
  }

  if (variant === "stat") {
    return (
      <div
        className={`card border-white/10 bg-white/[0.03] animate-pulse p-4 flex flex-col justify-between ${height} ${width ?? ""} ${className}`.trim()}
        role="status"
        aria-label="Loading stat..."
      >
        <div className="h-3 bg-white/10 rounded w-1/3 mb-2" />
        <div className="h-8 bg-white/10 rounded w-2/3" />
      </div>
    );
  }

  return (
    <div
      className={`card border-white/10 bg-white/[0.03] animate-pulse flex flex-col justify-between p-6 ${height} ${width ?? ""} ${className}`.trim()}
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
