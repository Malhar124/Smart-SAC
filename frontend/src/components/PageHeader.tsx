import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons on the band; use variant="line" for the primary one */
  actions?: ReactNode;
  /** Max width matching the page's <main>, so the title lines up with the content */
  width?: string;
  /** Shorter band for pages that need the vertical space, like Chat */
  compact?: boolean;
}

/**
 * Continues the court-green band below the fixed Navbar and closes it with the yellow court line.
 */
const PageHeader = ({ title, description, actions, width = "max-w-6xl", compact = false }: PageHeaderProps) => (
  <div className="bg-court text-court-foreground pt-16 court-line">
    <div className={cn("container mx-auto px-4 md:px-6", width)}>
      <div className={cn("flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between", compact ? "pt-4 pb-5" : "pt-8 pb-10 sm:pt-10 sm:pb-12")}>
        <div className="min-w-0">
          <h1 className={cn("type-title break-words", compact ? "text-4xl" : "text-5xl sm:text-6xl")}>{title}</h1>
          {description && <p className="mt-3 text-court-muted max-w-[60ch]">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  </div>
);

export default PageHeader;
