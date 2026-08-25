import { Suspense, type ReactNode } from "react";
import { ErrorBoundary } from "@/components/feedback/ErrorBoundary";
import { PageErrorFallback } from "@/components/feedback/PageErrorFallback";
import { PageLoader } from "@/components/feedback/PageLoader";

function renderPageErrorFallback(props: { error: Error; reset: () => void }) {
  return <PageErrorFallback {...props} />;
}

/**
 * Route-level error isolation for a lazily imported page: if it crashes, the
 * global chrome (header, spotlight search, toaster) keeps working.
 */
export function LazyRoute({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary fallback={renderPageErrorFallback}>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </ErrorBoundary>
  );
}
