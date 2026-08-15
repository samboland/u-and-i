/**
 * Canvas-side stand-ins for what adventure-alerts' root layout provides:
 * the icon-union SVG filters and the client providers. Loaded lazily only
 * when the harness boots in ?project=aa mode.
 *
 * AASvgDefs is copied from adventure-alerts src/app/layout.tsx (the hidden
 * <svg> before <Providers>) — if AA changes its filters this copy drifts;
 * icons rendering wrong in the canvas is the tell.
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "../next-shims/next-auth-react";
// AA's own sidebar context: client component, zero dependencies.
import { SidebarProvider } from "../../../../../adventure-alerts/src/components/layout/sidebar-context";

export function AASvgDefs() {
  return (
    <svg aria-hidden="true" focusable="false" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <defs>
        <filter id="ui-icon-union" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="1 0 0 0 0
                    0 1 0 0 0
                    0 0 1 0 0
                    0 0 0 1.34 0"
            result="thresholded"
          />
          <feFlood floodColor="currentColor" result="flood" />
          <feComposite in="flood" in2="thresholded" operator="in" />
        </filter>
        <filter id="ui-icon-union-rail" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="1 0 0 0 0
                    0 1 0 0 0
                    0 0 1 0 0
                    0 0 0 1.34 0"
            result="thresholded"
          />
          <feFlood floodColor="#F4EBE1" result="flood" />
          <feComposite in="flood" in2="thresholded" operator="in" />
        </filter>
      </defs>
    </svg>
  );
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

export function AAProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <SidebarProvider>
          <AASvgDefs />
          {children}
        </SidebarProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
