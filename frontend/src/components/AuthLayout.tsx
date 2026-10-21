import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import CourtDiagram from "@/components/CourtDiagram";
import { cn } from "@/lib/utils";

/**
 * Sign-in, sign-up and recovery pages. Matches the landing page: the form on the floor,
 * the court on the right. On phones the court becomes the green band with the yellow line.
 */
const AuthLayout = ({ children, wide = false }: { children: ReactNode; wide?: boolean }) => (
  <div className="min-h-screen bg-background grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <div className="hidden lg:flex bg-court items-center justify-center p-12 lg:order-2">
      <CourtDiagram orientation="portrait" className="h-[min(78vh,640px)] w-auto" />
    </div>

    <div className="flex flex-col min-w-0">
      <header className="bg-court text-court-foreground court-line px-6 py-4 sm:px-12 lg:bg-transparent lg:text-foreground lg:shadow-none lg:px-16 lg:pt-10">
        <Link to="/" className="type-display text-3xl">
          Smart SAC
        </Link>
      </header>
      <main id="main" className="flex-1 flex flex-col justify-center px-6 py-10 sm:px-12 lg:px-16">
        <div className={cn("w-full", wide ? "max-w-lg" : "max-w-md")}>{children}</div>
      </main>
    </div>
  </div>
);

export default AuthLayout;
