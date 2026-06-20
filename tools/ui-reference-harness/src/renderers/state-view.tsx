// Generic state renderer — maps a data-state to the shared design-system state component.
// No capability-specific markup: every capability reuses these.
import {
  LoadingState,
  EmptyState,
  ErrorState,
  ForbiddenState,
  Alert,
} from "@platform/ui-design-system";

export function StateView({
  state,
  capabilityKey,
  onRetry,
}: {
  state: string;
  capabilityKey: string;
  onRetry?: () => void;
}) {
  switch (state) {
    case "loading":
      return <LoadingState message={`Loading ${capabilityKey}…`} ariaLabel="Loading" />;
    case "empty":
      return (
        <EmptyState
          title={`No ${capabilityKey} yet`}
          description="Nothing to show for this state."
        />
      );
    case "forbidden":
      return (
        <ForbiddenState
          title="Access denied"
          description={`This persona cannot view ${capabilityKey}.`}
        />
      );
    case "serverError":
      return (
        <ErrorState
          title="Something went wrong"
          description="The server returned an error."
          onRetry={onRetry}
          retryLabel="Retry"
        />
      );
    case "degraded":
      return (
        <Alert variant="warning" data-testid="degraded-banner">
          Showing degraded data — some information may be stale.
        </Alert>
      );
    default:
      return null;
  }
}
