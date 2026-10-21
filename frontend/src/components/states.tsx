import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** An empty list: say what would be here and what to do about it */
export const EmptyState = ({ title, children, action, className }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) => (
  <div className={cn("border border-dashed border-border rounded-lg p-6", className)}>
    <p className="font-medium">{title}</p>
    {children && <div className="mt-1 text-sm text-muted-foreground max-w-[60ch]">{children}</div>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

/** A failed load: what went wrong and a way to retry */
export const ErrorState = ({
  title = "Couldn't load this",
  error,
  onRetry,
  className,
}: {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}) => (
  <div className={cn("border border-border rounded-lg bg-card p-6 max-w-xl", className)} role="alert">
    <p className="type-heading text-lg">{title}</p>
    <p className="mt-1 text-muted-foreground">
      {error instanceof Error ? error.message : "Check that you're online, then try again."}
    </p>
    {onRetry && (
      <Button className="mt-4" onClick={onRetry}>
        Try again
      </Button>
    )}
  </div>
);

export const ListSkeleton = ({ rows = 4, className, rowClassName = "h-12" }: { rows?: number; className?: string; rowClassName?: string }) => (
  <div className={cn("space-y-3", className)} aria-busy="true" aria-label="Loading">
    {Array.from({ length: rows }).map((_, i) => (
      <Skeleton key={i} className={cn("w-full", rowClassName)} />
    ))}
  </div>
);

/** Shown while a page's code loads: the court band and a few placeholder rows */
export const PageSkeleton = () => (
  <div className="min-h-screen bg-background" aria-busy="true" aria-label="Loading page">
    <div className="bg-court court-line h-[13.5rem]" />
    <div className="container mx-auto max-w-6xl px-4 md:px-6 pt-10">
      <ListSkeleton rows={5} />
    </div>
  </div>
);
