/**
 * next/navigation shim for the canvas. Navigation mutates the fake route
 * store; server-side helpers throw tagged errors the Boundary can present.
 */
import { navigate, setRoute, useRoute } from "./route-store";

export function useRouter() {
  return {
    push: (href: string) => navigate(href),
    replace: (href: string) => navigate(href),
    back: () => {},
    forward: () => {},
    refresh: () => {},
    prefetch: () => Promise.resolve(),
  };
}

export function usePathname(): string {
  return useRoute().pathname;
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams(useRoute().search);
}

export function useParams(): Record<string, string> {
  return {};
}

export function useSelectedLayoutSegment(): string | null {
  return null;
}

export function useSelectedLayoutSegments(): string[] {
  return [];
}

export function redirect(href: string): never {
  setRoute({ pathname: href });
  throw new Error(`redirect("${href}") — the canvas treats this as navigation`);
}

export function notFound(): never {
  throw new Error("notFound() — this component decided the route has no content");
}

export function permanentRedirect(href: string): never {
  return redirect(href);
}
