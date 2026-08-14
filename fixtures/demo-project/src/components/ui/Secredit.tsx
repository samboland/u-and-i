"use client";

import { useId, type SVGProps } from "react";

// ---------------------------------------------------------------------------
// <Secredit />
// ---------------------------------------------------------------------------
// Secretless in-app currency coin. Three layered regions rendered from the
// original Inkscape outline geometry at assets/credits/Secredit-render_v1.svg:
//   1. Outer coin silhouette filled with a raised-rim gradient.
//   2. Inner coin face filled with a recessed face gradient.
//   3. Italic "S" (Cormorant Garamond outlined) filled with an embossed
//      letter gradient, with a subtle stroke for edge definition.
// Light source is top-left per the skeuo convention used elsewhere
// (Rating Shape, Card). Viewbox is 1024x1024; rendered size controlled
// by the `size` prop. Decorative only -- aria-hidden by default.

export interface SecreditProps extends Omit<SVGProps<SVGSVGElement>, "fill" | "width" | "height"> {
  /** Rendered pixel size (square). Default 24. */
  size?: number;
}

// Silver/platinum palette. Three tones give the rim, face, and letter
// distinct brightness tiers before gradients further differentiate them.
const RIM_HIGH = "#F5F7FA";   // top-left highlight on the rim
const RIM_LOW = "#889099";    // bottom-right shadow on the rim
const FACE_HIGH = "#BAC1CA";  // top-left bright on the face (kept well below RIM_HIGH so the face reads recessed)
const FACE_MID = "#7C848E";   // mid-face main tone
const FACE_EDGE = "#343A42";  // dark ring at the face perimeter (rim-cast shadow)
const LETTER_HIGH = "#EEF1F5";// top-left on the embossed letter
const LETTER_LOW = "#9CA5B0"; // bottom-right on the letter

// Cool near-black used to flood the inner/drop shadows. Neutral rather
// than the old warm brown so it reads as shadow on a silver surface.
const SHADOW_FLOOD = "#10141a";

// Coin silhouette path (outer). Distorted-squircle geometry from the
// source SVG -- keep the transform intact so the relative inner-rim /
// letterform positioning stays authoritative.
const OUTER_COIN_D =
  "m 512,128 c -25.24192,0 -153.37377,135.00497 -173.79492,149.8418 -20.42114,14.83682 -188.41466,94.97983 -196.21485,118.98632 -7.80018,24.00649 81.00257,187.58532 88.80274,211.5918 7.80018,24.0065 32.10815,208.54404 52.5293,223.38086 20.42114,14.83683 203.43582,-19.07031 228.67773,-19.07031 25.24192,0 208.25658,33.90715 228.67773,19.07031 20.42114,-14.83682 44.72912,-199.37437 52.5293,-223.38086 7.80018,-24.00649 96.60292,-187.58531 88.80274,-211.5918 C 874.20958,372.82163 706.21606,292.67862 685.79492,277.8418 665.37378,263.00496 537.24192,128 512,128 Z";

const LETTER_S_D =
  "m 470.33594,335.98047 c -2.88879,-0.15419 -5.40717,1.84189 -5.95703,4.55859 -37.80911,89.91127 -75.6149,179.82431 -113.45703,269.71875 -2.45678,5.51762 -5.11027,10.93325 -8.03321,16.1836 -0.38942,0.6716 -0.90981,1.59198 -1.34961,2.35937 -6.24671,10.78404 -13.89512,20.74648 -23.34179,28.83594 -4.77478,4.08303 -10.03028,7.72022 -15.97266,10.1289 -3.37553,1.27194 -7.02411,1.9604 -10.75586,2.06641 -1.67644,0.65848 -2.54574,2.45116 -2.4082,4.2793 0.10281,2.0079 0.7348,4.45158 2.7539,5.57422 1.65216,0.76404 3.44471,0.53348 5.12305,0.48047 3.0336,-0.14103 6.08135,-0.20388 9.10547,-0.41016 8.89748,-0.50243 17.8251,-1.23939 26.67383,-1.53711 7.66222,-0.2542 15.3846,-0.0556 23.09765,0.13086 15.53313,0.43981 31.19228,1.43689 46.75391,1.83984 0.98885,-0.0291 2.10341,-0.0636 2.87109,-0.62695 1.54408,-1.29253 1.58326,-3.56941 1.3125,-5.56055 -0.12522,-1.69938 -1.18151,-3.69739 -3.04492,-4.09961 -2.49872,-0.4567 -4.95929,-0.12407 -7.45312,-0.35937 -7.6402,-0.38011 -15.53892,-1.41314 -22.8125,-4.87305 -5.89503,-3.03137 -10.06677,-9.35122 -10.60157,-15.63086 -1.04276,-7.12691 0.47881,-14.00296 2.17188,-20.59179 3.39219,-12.53408 8.92651,-24.12087 13.6289,-36.0625 4.71194,-11.48378 9.42284,-22.96739 14.13477,-34.45118 h 96.49023 c 8.50634,27.40264 17.06619,54.78707 25.5,82.19336 1.56752,6.17943 2.87704,12.62454 1.76563,18.6875 -0.83163,3.81769 -3.49313,7.05498 -7.19531,8.32617 -5.41607,2.33845 -11.66325,2.37488 -17.67383,2.67188 -1.95122,0.25145 -2.88994,2.25152 -2.8457,4.0918 0.0158,2.08747 0.72029,4.60718 2.79101,5.79687 1.54682,0.70205 3.24388,0.48636 4.83203,0.48047 8.2551,-0.24812 16.4897,-0.72818 24.69727,-1.18555 5.35048,-0.2962 10.70782,-0.55507 16.07812,-0.72851 8.09635,-0.25461 16.48029,-0.20241 24.66797,0.10937 13.84879,0.48738 27.74252,1.54916 41.57227,1.80469 0.98491,-0.009 2.01034,-0.0527 2.9082,-0.3457 1.53,-1.04277 2.0608,-3.05066 1.71094,-4.94922 -0.21869,-1.85219 -1.11422,-3.9813 -3.03125,-4.80078 -1.48432,-0.55724 -3.04223,-0.35619 -4.54688,-0.44727 -2.98485,-0.0932 -5.99607,-0.32593 -8.98828,-0.87695 -4.11591,-0.74479 -8.31107,-2.54556 -11.3125,-5.78906 -2.77655,-2.85551 -4.5219,-6.47232 -5.64258,-10.12305 -3.74234,-11.03617 -6.91921,-22.19073 -10.35742,-33.28906 -28.75818,-93.48315 -57.49353,-186.97034 -86.24414,-280.45508 -1.64362,-1.95963 -4.14281,-2.97531 -6.52344,-3.0918 -0.36497,-0.0262 -0.72954,-0.0382 -1.09179,-0.0332 z m 206.85547,2.17187 c -10.1554,0.2393 -20.28291,1.34599 -29.66602,4.4336 -1.53165,0.60098 -3.22893,1.50933 -3.46289,3.31836 -0.0208,2.16591 0.34149,4.37823 0.54297,6.56445 1.77912,17.9914 3.53255,35.98302 5.12305,53.9707 3.39449,37.96334 6.27752,75.9745 8.67382,113.89453 1.13481,18.32142 2.20314,36.64036 3.08204,54.94532 -0.0711,1.85254 0.79715,3.95567 2.5996,4.94922 2.58998,1.54776 5.82965,0.26848 6.82227,-2.16211 0.50955,-1.37208 0.46602,-2.93724 0.73437,-4.39258 2.71137,-20.57795 5.77075,-41.07175 8.96485,-61.52735 4.30711,-27.31107 9.07352,-54.50139 14.48242,-81.49804 4.41925,-21.93653 9.22552,-43.83463 14.71094,-65.44922 1.56888,-6.23392 3.1811,-12.45201 4.8164,-18.66211 -0.12385,-1.4851 -1.25231,-2.78583 -2.62109,-3.42578 -2.65552,-1.43088 -5.60148,-1.8616 -8.42969,-2.5625 -8.77908,-1.82103 -17.63558,-2.4685 -26.37304,-2.39649 z m -229.50586,85.94922 c 11.88686,38.26494 23.77329,76.52999 35.66015,114.79492 h -82.75 c 15.69645,-38.26493 31.3934,-76.52998 47.08985,-114.79492 z m 214.1289,197.04297 c -8.30406,0.0524 -16.46616,3.0672 -21.51953,9.19531 -4.31161,5.1567 -5.89196,12.29185 -5.32617,19.32813 0.52771,7.04095 2.34434,14.33788 6.50781,20.58789 3.68633,5.64328 9.45412,9.93326 15.70899,12.07617 7.86662,2.7012 16.31937,2.8606 23.71289,0.5293 5.68816,-1.90423 10.34879,-6.01383 12.92383,-11.33399 2.5834,-5.05947 3.27301,-11.03744 2.84765,-16.95507 -0.43352,-7.30281 -2.62358,-14.97771 -7.53125,-21.10743 -4.92981,-6.22121 -12.24098,-10.72775 -19.83594,-11.80273 -2.49974,-0.40864 -5.00867,-0.55487 -7.48828,-0.51758 z";

// ---------------------------------------------------------------------------
// <SecreditIcon />
// ---------------------------------------------------------------------------
// Flat single-color icon version of the coin. Rim silhouette filled with
// currentColor; the S cuts out as a transparent hole via an SVG mask so
// whatever sits behind the icon shows through the letter. Use anywhere
// lucide-style icons are used (inside .ui-icon-wrap, inside PrimaryButton's
// icon slot, etc.). No shading, no shadows -- the rendered button / label
// owns the surface treatment.

export interface SecreditIconProps extends Omit<SVGProps<SVGSVGElement>, "fill" | "width" | "height"> {
  /** Rendered pixel size (square). Default 20 (matches lucide icon sizing). */
  size?: number;
}

export function SecreditIcon({ size = 20, ...rest }: SecreditIconProps) {
  const uid = useId().replace(/:/g, "");
  const maskId = `secredit-icon-mask-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      /* viewBox y offset shifts the visible coin upward to optically
         center it inside the rendered box. The source geometry sits
         slightly below the 1024 viewBox's vertical center, which
         reads as ~1px too low when dropped into iconwells at small
         sizes. Shift in viewBox units scales proportionally at every
         rendered size. */
      viewBox="0 36 1024 1024"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...rest}
    >
      <defs>
        <mask id={maskId}>
          {/* Mask layers composite in order: white = visible, black =
              hidden. Rim band + S are filled; the face area between
              them is transparent so whatever sits behind shows through.
                1. Outer coin silhouette (white)      -> full coin visible
                2. Inner face (black, scaled 0.84x)   -> hides face area
                3. S letter (white, restores over 2)  -> S visible again */}
          <g transform="matrix(1.1083425,0,0,1.1083425,-55.471329,-32.805271)">
            <path
              d={OUTER_COIN_D}
              transform="matrix(1.2194829,0,0,1.2194829,-112.37527,-116.25019)"
              fill="white"
            />
            <path
              d={OUTER_COIN_D}
              transform="matrix(1.0251695,0,0,1.0251695,-12.886793,-13.331156)"
              fill="black"
            />
            <path d={LETTER_S_D} fill="white" />
          </g>
        </mask>
      </defs>
      {/* currentColor fill so the icon inherits color from the parent's
          text color, matching the lucide convention. */}
      <rect width="1024" height="1024" fill="currentColor" mask={`url(#${maskId})`} />
    </svg>
  );
}

export function Secredit({ size = 24, ...rest }: SecreditProps) {
  // Per-instance gradient + filter ids so multiple coins on one page
  // don't share (and potentially collide with) the same <defs>.
  const uid = useId().replace(/:/g, "");
  const rimId = `secredit-rim-${uid}`;
  const faceId = `secredit-face-${uid}`;
  const letterId = `secredit-letter-${uid}`;
  const faceInnerShadowId = `secredit-face-inner-${uid}`;
  const letterDropShadowId = `secredit-letter-drop-${uid}`;
  const rimDropShadowId = `secredit-rim-drop-${uid}`;

  // Outer coin shadow scales with rendered size so the visual weight
  // reads consistently at 24 / 48 / 96 / 160 px. Applied as a CSS
  // filter on the <svg> element (not an SVG internal filter) so the
  // shadow naturally paints outside the viewBox without clipping.
  //
  // Color + alpha come from CSS custom properties so dark mode can
  // punch the shadow harder against a dark background (where a
  // low-alpha black would otherwise disappear into the backdrop).
  const outerShadowBlur = size * 0.08;
  const outerShadowDx = size * 0.025;
  const outerShadowDy = size * 0.05;
  const outerShadowCss = `drop-shadow(${outerShadowDx}px ${outerShadowDy}px ${outerShadowBlur}px rgba(0, 0, 0, var(--secredit-shadow-alpha, 0.35)))`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...rest}
      style={{ overflow: "visible", filter: outerShadowCss, ...(rest.style ?? {}) }}
    >
      <defs>
        {/* Rim: top-left bright, bottom-right shadow. Linear gradient
            sloped ~135deg reads as a raised bevel catching light from
            the top-left, same convention as Rating Shape + Card. */}
        <linearGradient id={rimId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={RIM_HIGH} />
          <stop offset="100%" stopColor={RIM_LOW} />
        </linearGradient>
        {/* Face: three-stop radial reading as a concave recess inside
            the rim. Bright highlight off-center toward top-left,
            mid-tone for the majority of the face, then a dark ring at
            the perimeter to read as the rim's cast shadow on the face
            (the "lip" where rim meets face). */}
        <radialGradient id={faceId} cx="0.35" cy="0.3" r="0.95">
          <stop offset="0%" stopColor={FACE_HIGH} />
          <stop offset="60%" stopColor={FACE_MID} />
          <stop offset="100%" stopColor={FACE_EDGE} />
        </radialGradient>
        {/* Letter: lighter gradient matching rim direction so the
            embossed "S" catches light on the same facet as the rim. */}
        <linearGradient id={letterId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={LETTER_HIGH} />
          <stop offset="100%" stopColor={LETTER_LOW} />
        </linearGradient>

        {/* Face inner shadow: canonical inner-shadow recipe (offset the
            source alpha, subtract to get the top-left edge band, blur
            for softness, flood dark, composite back over the source).
            This produces a visible dark band along the top-left inner
            perimeter -- the rim casting shadow down onto the face --
            same grammar as the S drop shadow onto the face below it. */}
        <filter id={faceInnerShadowId} x="-10%" y="-10%" width="120%" height="120%">
          <feOffset in="SourceAlpha" dx="10" dy="14" result="offsetAlpha" />
          <feGaussianBlur in="offsetAlpha" stdDeviation="6" result="blurredOffset" />
          <feComposite in="SourceAlpha" in2="blurredOffset" operator="arithmetic" k2="1" k3="-1" result="topLeftBand" />
          <feFlood floodColor={SHADOW_FLOOD} floodOpacity="0.45" result="flood" />
          <feComposite in="flood" in2="topLeftBand" operator="in" result="darkBand" />
          <feComposite in="darkBand" in2="SourceGraphic" operator="over" />
        </filter>

        {/* Letter drop shadow: S is raised above the face. Soft shadow
            cast down-right matches the top-left light source. Tuned
            softer + tighter than the first pass so the S doesn't
            feel heavy at small sizes. */}
        <filter id={letterDropShadowId} x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="5" dy="8" stdDeviation="7" floodColor={SHADOW_FLOOD} floodOpacity="0.6" />
        </filter>

        {/* Rim bevel shadow: rim reads as a raised ring above the face.
            Heavier than the letter so the rim separation carries at
            small sizes and the rim's elevation dominates the letter's. */}
        <filter id={rimDropShadowId} x="-15%" y="-15%" width="130%" height="130%">
          <feDropShadow dx="5" dy="8" stdDeviation="7" floodColor={SHADOW_FLOOD} floodOpacity="0.6" />
        </filter>
      </defs>

      <g transform="matrix(1.1083425,0,0,1.1083425,-55.471329,-32.805271)">
        {/* Layer 1: outer rim silhouette with raised gradient + bevel
            drop shadow (same magnitude as the letter shadow; rim reads
            as a raised ring above the face beneath). */}
        <path
          d={OUTER_COIN_D}
          transform="matrix(1.2194829,0,0,1.2194829,-112.37527,-116.25019)"
          fill={`url(#${rimId})`}
          filter={`url(#${rimDropShadowId})`}
        />
        {/* Layer 2: inner face with recessed radial gradient + inner
            shadow filter. The inner shadow creates the depth cue at
            the rim-face boundary -- same grammar as the S drop shadow
            onto the face. Scaled 0.84x of the outer so the rim band
            shows around it. */}
        <path
          d={OUTER_COIN_D}
          transform="matrix(1.0251695,0,0,1.0251695,-12.886793,-13.331156)"
          fill={`url(#${faceId})`}
          filter={`url(#${faceInnerShadowId})`}
        />
        {/* Layer 3: letter S with embossed gradient + drop shadow
            (S sits raised above the face, shadow falls bottom-right). */}
        <path
          d={LETTER_S_D}
          fill={`url(#${letterId})`}
          filter={`url(#${letterDropShadowId})`}
        />
      </g>
    </svg>
  );
}
