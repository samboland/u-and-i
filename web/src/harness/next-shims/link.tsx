/**
 * next/link shim: a real anchor that routes through the canvas's fake
 * router instead of reloading the iframe.
 */
import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";
import { navigate } from "./route-store";

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string | { pathname?: string; query?: Record<string, string> };
  children?: ReactNode;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  legacyBehavior?: boolean;
}

function hrefToString(href: LinkProps["href"]): string {
  if (typeof href === "string") return href;
  const q = href.query ? `?${new URLSearchParams(href.query)}` : "";
  return `${href.pathname ?? ""}${q}`;
}

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, prefetch: _p, replace: _r, scroll: _s, shallow: _sh, legacyBehavior: _l, onClick, children, ...rest },
  ref,
) {
  const url = hrefToString(href);
  return (
    <a
      ref={ref}
      href={url}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) {
          e.preventDefault();
          navigate(url);
        }
      }}
      {...rest}
    >
      {children}
    </a>
  );
});

export default Link;
