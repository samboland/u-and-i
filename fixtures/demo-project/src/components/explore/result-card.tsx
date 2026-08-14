/**
 * Compact product tile used by /explore and (later) other listing surfaces.
 * Server component: renders a static <a> wrapping product image + meta.
 *
 * Intentionally lighter than ProductCardLayout (which is the full product
 * page card). The grid tile only needs: image, name, brand, score badge,
 * recall flag. Anything richer belongs on the product detail page.
 */
import Link from "next/link";

export interface ExploreResultCardProduct {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  score: number | null;
  recallFlag: boolean;
}

interface Props {
  product: ExploreResultCardProduct;
}

export function ExploreResultCard({ product }: Props) {
  const score = product.score;
  return (
    <Link
      href={`/product/${product.slug}`}
      className="ui-card explore-card"
      aria-label={
        product.brand ? `${product.brand} — ${product.name}` : product.name
      }
      style={{
        display: "flex",
        flexDirection: "column",
        textDecoration: "none",
        color: "inherit",
        padding: "0.875rem",
        gap: "0.5rem",
        height: "100%",
      }}
    >
      <div
        className="ui-iconwell--recess"
        aria-hidden="true"
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1 / 1",
          borderRadius: 10,
          overflow: "hidden",
          background: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt=""
            loading="lazy"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              padding: "8%",
              boxSizing: "border-box",
            }}
          />
        ) : (
          <span
            style={{
              fontSize: "0.75rem",
              color: "var(--ui-text-faint)",
              fontStyle: "italic",
            }}
          >
            no image
          </span>
        )}
        {score != null && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              padding: "0.15rem 0.5rem",
              borderRadius: 999,
              fontSize: "0.6875rem",
              fontWeight: 700,
              letterSpacing: "0.04em",
              background: "rgba(15, 17, 23, 0.85)",
              color: "white",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {score} / 7
          </span>
        )}
        {product.recallFlag && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              padding: "0.15rem 0.5rem",
              borderRadius: 999,
              fontSize: "0.6875rem",
              fontWeight: 700,
              letterSpacing: "0.04em",
              background: "#b91c1c",
              color: "white",
              textTransform: "uppercase",
            }}
          >
            recall
          </span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem", minWidth: 0 }}>
        <span
          style={{
            fontSize: "0.6875rem",
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--ui-text-faint)",
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {product.brand ?? "Unknown brand"}
        </span>
        <span
          style={{
            fontSize: "0.875rem",
            fontWeight: 600,
            color: "var(--ui-text-primary)",
            lineHeight: 1.25,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {product.name}
        </span>
        {product.score == null && (
          <span
            style={{
              fontSize: "0.6875rem",
              color: "var(--ui-text-faint)",
              fontStyle: "italic",
            }}
          >
            Not yet synthesized
          </span>
        )}
      </div>
    </Link>
  );
}
