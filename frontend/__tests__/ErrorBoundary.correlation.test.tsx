import * as Sentry from "@sentry/nextjs";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { createActionId } from "@/lib/correlation";

jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));
jest.mock("@/lib/logger", () => ({
  logger: { error: jest.fn() },
}));

function BrokenComponent(): never {
  throw new Error("simulated trace failure");
}

describe("ErrorBoundary correlation capture", () => {
  it("sends the active correlation ID to Sentry without rendering it", () => {
    const correlationId = createActionId();
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <ErrorBoundary name="TracingWidget">
        <BrokenComponent />
      </ErrorBoundary>,
    );

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "simulated trace failure" }),
      expect.objectContaining({
        tags: expect.objectContaining({ correlationId, component: "TracingWidget" }),
      }),
    );
    expect(screen.queryByText(correlationId)).not.toBeInTheDocument();
    expect(screen.queryByText(/simulated trace failure/)).not.toBeInTheDocument();
    consoleError.mockRestore();
  });
});
