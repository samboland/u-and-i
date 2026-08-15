/**
 * The canvas's fake Next router state. next/link and next/navigation shims
 * read and write this store, so client components that navigate behave
 * plausibly inside the harness without any Next runtime.
 */
import { useSyncExternalStore } from "react";

export interface RouteState {
  pathname: string;
  search: string;
}

let state: RouteState = { pathname: "/", search: "" };
const listeners = new Set<() => void>();

export function getRoute(): RouteState {
  return state;
}

export function setRoute(next: Partial<RouteState>): void {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function navigate(href: string): void {
  try {
    const u = new URL(href, "http://canvas.local");
    setRoute({ pathname: u.pathname, search: u.search });
  } catch {
    setRoute({ pathname: href, search: "" });
  }
}

export function useRoute(): RouteState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getRoute,
    getRoute,
  );
}
