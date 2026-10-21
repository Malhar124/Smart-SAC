import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { reportError } from "@/lib/monitoring";

interface State {
  error: Error | null;
}

/** Catches a crash in one page so the rest of the app keeps working, and reports it */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { componentStack: info.componentStack });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="min-h-screen bg-background flex items-center px-6 sm:px-12 lg:px-16" role="alert">
        <div className="max-w-md">
          <h1 className="type-title text-4xl">This page hit a problem</h1>
          <p className="mt-3 text-muted-foreground">
            Something unexpected went wrong while showing it. Reloading usually fixes it; if it keeps happening, tell the
            SAC desk what you were doing.
          </p>
          <div className="mt-8 flex gap-2">
            <Button onClick={() => window.location.reload()}>Reload the page</Button>
            <Button variant="outline" onClick={() => (window.location.href = "/")}>
              Go to the start
            </Button>
          </div>
        </div>
      </main>
    );
  }
}
