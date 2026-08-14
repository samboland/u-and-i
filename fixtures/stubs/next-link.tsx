/**
 * Stub for next/link in the harness: renders a plain anchor and forwards all
 * props (including the injected data-uai id) to the DOM.
 */
import { type AnchorHTMLAttributes, type ReactNode } from "react";

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  children: ReactNode;
}

export default function Link({ href, children, ...rest }: LinkProps) {
  return (
    <a href={href} onClick={(e) => e.preventDefault()} {...rest}>
      {children}
    </a>
  );
}
