import "@tanstack/react-query";

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** The page shows this mutation's errors itself, so skip the global toast */
      silent?: boolean;
    };
  }
}
