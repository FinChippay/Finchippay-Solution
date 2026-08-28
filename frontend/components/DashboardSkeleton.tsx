import React from "react";
import Skeleton from "./Skeleton";

interface DashboardSkeletonProps {
  className?: string;
}

export default function DashboardSkeleton({ className = "" }: DashboardSkeletonProps) {
  return (
    <div className={`space-y-6 animate-pulse ${className}`.trim()} role="status" aria-label="Loading dashboard...">
      {/* Top Banner Skeleton */}
      <div className="h-20 rounded-xl bg-white/[0.05] border border-white/10" />

      {/* Main Stats Grid Skeleton */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Skeleton height="h-32" />
        <Skeleton height="h-32" />
        <Skeleton height="h-32" />
        <Skeleton height="h-32" />
      </div>

      {/* Main Content & Charts Grid Skeleton */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Skeleton height="h-80" />
          <Skeleton height="h-96" />
        </div>
        <div className="space-y-6">
          <Skeleton height="h-64" />
          <Skeleton height="h-64" />
        </div>
      </div>
    </div>
  );
}
