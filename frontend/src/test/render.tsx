import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

/** Render a page with the providers the app gives it, at `route` */
export const renderPage = (ui: ReactElement, { route = "/" }: { route?: string } = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <TooltipProvider>{ui}</TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

/** api.get stand-in that answers from a table of endpoint -> data, and fails loudly for anything else */
export const answer =
  (table: Record<string, unknown>) =>
  async (endpoint: string): Promise<unknown> => {
    if (endpoint in table) return table[endpoint];
    throw new Error(`Unexpected GET ${endpoint}`);
  };
