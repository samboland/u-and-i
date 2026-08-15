/** next/font/local shim — fonts arrive via aa-fonts.css instead. */
export default function localFont(_opts: unknown): {
  className: string;
  variable: string;
  style: Record<string, string>;
} {
  return { className: "", variable: "", style: {} };
}
