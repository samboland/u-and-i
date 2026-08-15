/**
 * next-auth/react shim: a fake, always-authenticated session so shell
 * components (header, sign-out) render. The editor can swap the session via
 * the set-session protocol message.
 */
import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export interface FakeSession {
  user: { name: string; email: string; image: string | null; role?: string };
  expires: string;
}

export const DEFAULT_SESSION: FakeSession = {
  user: { name: "Canvas Traveler", email: "traveler@example.com", image: null, role: "traveler" },
  expires: "2099-01-01T00:00:00.000Z",
};

let currentSession: FakeSession | null = DEFAULT_SESSION;
const listeners = new Set<(s: FakeSession | null) => void>();

/** Called by the harness when the editor sends set-session. */
export function setCanvasSession(session: FakeSession | null): void {
  currentSession = session;
  listeners.forEach((l) => l(session));
}

const Ctx = createContext<FakeSession | null>(currentSession);

export function SessionProvider({ children }: { session?: unknown; children: ReactNode }) {
  const [session, setSession] = useState(currentSession);
  useEffect(() => {
    listeners.add(setSession);
    return () => {
      listeners.delete(setSession);
    };
  }, []);
  return <Ctx.Provider value={session}>{children}</Ctx.Provider>;
}

export function useSession() {
  const session = useContext(Ctx);
  return session
    ? ({ data: session, status: "authenticated" } as const)
    : ({ data: null, status: "unauthenticated" } as const);
}

export async function signIn(): Promise<void> {}
export async function signOut(): Promise<void> {}
export async function getSession(): Promise<FakeSession | null> {
  return currentSession;
}
export async function getCsrfToken(): Promise<string> {
  return "canvas-csrf";
}
