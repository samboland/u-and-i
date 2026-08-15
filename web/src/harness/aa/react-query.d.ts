/**
 * @tanstack/react-query resolves at runtime from adventure-alerts'
 * node_modules (vite alias) — u-and-i deliberately doesn't depend on it.
 * Minimal ambient types keep tsc happy on machines without the checkout.
 */
declare module "@tanstack/react-query" {
  import type { ReactNode } from "react";
  export class QueryClient {
    constructor(config?: unknown);
  }
  export function QueryClientProvider(props: {
    client: QueryClient;
    children?: ReactNode;
  }): ReactNode;
}
