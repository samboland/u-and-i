/** next/image shim: a plain img; `fill` maps to absolute positioning. */
import { forwardRef, type CSSProperties, type ImgHTMLAttributes } from "react";

interface ImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string | { src: string };
  fill?: boolean;
  priority?: boolean;
  quality?: number | string;
  loader?: unknown;
  placeholder?: string;
  blurDataURL?: string;
  unoptimized?: boolean;
}

const Image = forwardRef<HTMLImageElement, ImageProps>(function Image(
  { src, fill, priority: _p, quality: _q, loader: _l, placeholder: _ph, blurDataURL: _b, unoptimized: _u, style, ...rest },
  ref,
) {
  const fillStyle: CSSProperties = fill
    ? { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }
    : {};
  return <img ref={ref} src={typeof src === "string" ? src : src.src} style={{ ...fillStyle, ...style }} {...rest} />;
});

export default Image;
