import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  return (
    <main id="main" className="min-h-screen bg-background flex items-center px-6 sm:px-12 lg:px-16">
      <div className="max-w-md">
        <p className="type-display text-8xl text-line" aria-hidden>
          Out
        </p>
        <h1 className="mt-4 type-title text-3xl">There's no page here</h1>
        <p className="mt-3 text-muted-foreground">
          Nothing lives at <code className="text-foreground break-all">{location.pathname}</code>. The link may be old or
          mistyped.
        </p>
        <Button asChild className="mt-8">
          <Link to="/">Back to Smart SAC</Link>
        </Button>
      </div>
    </main>
  );
};

export default NotFound;
