/**
 * components/ErrorBoundary.tsx
 * Enhanced error boundary with per-section isolation, Sentry integration,
 * network vs code error detection, and recovery options (retry, reset, go home).
 *
 * Resolves #257.
 */

import React, { Component, ErrorInfo, ReactNode } from "react";
import * as Sentry from "@sentry/nextjs";
import { AlertCircleIcon } from "@/components/icons";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
  /** Optional callback invoked with (error, errorInfo, level) on capture. */
  onError?: (error: Error, errorInfo: ErrorInfo, level: string) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });

    const componentName = this.props.name || "UnnamedBoundary";

    // Send to Sentry with component name and componentStack
    Sentry.withScope((scope) => {
      scope.setTag("error_boundary", componentName);
      scope.setExtra("componentStack", errorInfo.componentStack);
      scope.setLevel("error");
      Sentry.captureException(error);
    });

    // Invoke optional onError callback
    this.props.onError?.(error, errorInfo, "error");
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  private handleResetAndContinue = () => {
    // Hard reload to reset all application state
    window.location.reload();
  };

  private isNetworkError(error: Error): boolean {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("network") ||
      msg.includes("fetch") ||
      msg.includes("abort") ||
      msg.includes("timeout") ||
      msg.includes("failed to fetch") ||
      msg.includes("networkerror")
    );
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isOffline =
        typeof navigator !== "undefined" && !navigator.onLine;
      const isNetworkErr = this.state.error
        ? this.isNetworkError(this.state.error)
        : false;
      const showOfflineUI = isOffline || isNetworkErr;

      return (
        <div className="p-6 rounded-2xl border border-red-500/20 bg-red-50 dark:bg-red-950/10 backdrop-blur-md text-slate-700 dark:text-slate-200 shadow-xl max-w-lg mx-auto my-4 animate-fade-in">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-red-500/10 text-red-700 dark:text-red-400 flex-shrink-0">
              <AlertCircleIcon className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-red-700 dark:text-red-400">
                {showOfflineUI
                  ? "No internet connection"
                  : `Failed to load ${this.props.name || "component"}`}
              </h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                {showOfflineUI
                  ? "You appear to be offline. Check your connection and try again."
                  : "An unexpected error occurred while rendering this section."}
              </p>
              {this.state.error && !showOfflineUI && (
                <div className="mt-3 p-3 rounded-lg bg-black/40 border border-white/5 text-xs font-mono text-slate-500 max-h-32 overflow-auto">
                  {this.state.error.toString()}
                </div>
              )}
              <div className="mt-4 flex gap-3">
                <button
                  onClick={this.handleReset}
                  className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 active:bg-red-500/40 border border-red-500/30 text-red-700 dark:text-red-300 text-sm font-medium rounded-xl transition-all duration-200"
                >
                  Try Again
                </button>
                <button
                  onClick={this.handleResetAndContinue}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 active:bg-slate-400 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-sm font-medium rounded-xl transition-all duration-200"
                >
                  Reset & Continue
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  name: string
) {
  const ComponentWithErrorBoundary = (props: P) => (
    <ErrorBoundary name={name}>
      <WrappedComponent {...props} />
    </ErrorBoundary>
  );

  ComponentWithErrorBoundary.displayName = `WithErrorBoundary(${
    WrappedComponent.displayName || WrappedComponent.name || "Component"
  })`;

  return ComponentWithErrorBoundary;
}