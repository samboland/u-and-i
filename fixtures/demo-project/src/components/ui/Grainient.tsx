"use client";

import { memo, useEffect, useRef } from "react";
import { Renderer, Program, Mesh, Triangle } from "ogl";

const hexToRgb = (hex: string): [number, number, number] => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [1, 1, 1];
  return [
    parseInt(result[1]!, 16) / 255,
    parseInt(result[2]!, 16) / 255,
    parseInt(result[3]!, 16) / 255,
  ];
};

const vertex = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragment = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uTimeSpeed;
uniform float uColorBalance;
uniform float uWarpStrength;
uniform float uWarpFrequency;
uniform float uWarpSpeed;
uniform float uWarpAmplitude;
uniform float uBlendAngle;
uniform float uBlendSoftness;
uniform float uRotationAmount;
uniform float uNoiseScale;
uniform float uGrainAmount;
uniform float uGrainScale;
uniform float uGrainAnimated;
uniform float uContrast;
uniform float uGamma;
uniform float uSaturation;
uniform vec2 uCenterOffset;
uniform float uZoom;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform vec3 uColor4;
uniform vec4 uMaskRect;
uniform float uMaskRadius;
uniform float uMaskEdge;
uniform float uMaskWarp;
uniform float uIntensity;
uniform vec2 uMouse;
uniform float uFocus;
uniform float uPulse;
uniform float uColorBlur;
uniform vec4 uBlurRect;
uniform float uBlurEdge;
out vec4 fragColor;
#define S(a,b,t) smoothstep(a,b,t)
mat2 Rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}
vec2 hash(vec2 p){p=vec2(dot(p,vec2(2127.1,81.17)),dot(p,vec2(1269.5,283.37)));return fract(sin(p)*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);float n=mix(mix(dot(-1.0+2.0*hash(i+vec2(0.0,0.0)),f-vec2(0.0,0.0)),dot(-1.0+2.0*hash(i+vec2(1.0,0.0)),f-vec2(1.0,0.0)),u.x),mix(dot(-1.0+2.0*hash(i+vec2(0.0,1.0)),f-vec2(0.0,1.0)),dot(-1.0+2.0*hash(i+vec2(1.0,1.0)),f-vec2(1.0,1.0)),u.x),u.y);return 0.5+0.5*n;}
float sdRoundBox(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.0))+min(max(q.x,q.y),0.0)-r;}

// Color field computation — separated so we can multi-sample for blur
vec3 colorField(vec2 C){
  float t=iTime*uTimeSpeed;
  vec2 uv=C/iResolution.xy;
  float ratio=iResolution.x/iResolution.y;
  vec2 tuv=uv-0.5+uCenterOffset;
  tuv/=max(uZoom,0.001);

  float degree=noise(vec2(t*0.1,tuv.x*tuv.y)*uNoiseScale);
  tuv.y*=1.0/ratio;
  tuv*=Rot(radians((degree-0.5)*uRotationAmount+180.0));
  tuv.y*=ratio;

  float frequency=uWarpFrequency;
  float ws=max(uWarpStrength,0.001);
  float amplitude=uWarpAmplitude/ws;
  float warpTime=t*uWarpSpeed;
  tuv.x+=sin(tuv.y*frequency+warpTime)/amplitude;
  tuv.y+=sin(tuv.x*(frequency*1.5)+warpTime)/(amplitude*0.5);

  // Color blend:
  // - If color4 is zero-length → 3-stop legacy gradient (c3→c2→c1).
  // - Otherwise → 4-stop blend along a rotated axis (c1 → c2 → c3 → c4),
  //   so each of the 4 colors gets its own visible band in the warped
  //   gradient rather than mashing corners together.
  vec3 c1=uColor1;
  vec3 c2=uColor2;
  vec3 c3=uColor3;
  vec3 c4=uColor4;
  float b=uColorBalance;
  float s=max(uBlendSoftness,0.0);
  mat2 blendRot=Rot(radians(uBlendAngle));
  float blendX=(tuv*blendRot).x;

  if(dot(c4,c4)<0.0001){
    float edge0=-0.3-b-s;
    float edge1=0.2-b+s;
    float v0=0.5-b+s;
    float v1=-0.3-b-s;
    float hx=S(edge0,edge1,blendX);
    float vy=S(v0,v1,tuv.y);
    vec3 layer1=mix(c3,c2,hx);
    vec3 layer2=mix(c2,c1,hx);
    return mix(layer1,layer2,vy);
  }

  // 4-stop gradient: remap blendX into [0,1] then interpolate between
  // (c1,c2,c3,c4) as evenly-spaced stops. Each stop gets ~25% of the
  // width; cross-fade between adjacent stops via smoothstep.
  float stopT=clamp((blendX+0.7-b)/1.4,0.0,1.0);
  float sm=0.18+s;
  vec3 col12=mix(c1,c2,S(0.0,0.33+sm,stopT));
  vec3 col23=mix(col12,c3,S(0.33-sm,0.67+sm,stopT));
  vec3 col34=mix(col23,c4,S(0.67-sm,1.0,stopT));
  return col34;
}

void mainImage(out vec4 o, vec2 C){
  // Spatial blur blend factor from blurRect
  vec2 bUv=C/iResolution.xy-0.5;
  float ar=iResolution.x/iResolution.y;
  bUv.x*=ar;
  vec2 bCenter=uBlurRect.xy*vec2(ar,1.0);
  vec2 bHalf=uBlurRect.zw*0.5*vec2(ar,1.0);
  float bDist=sdRoundBox(bUv-bCenter,bHalf,0.015);
  float blurMix=1.0-S(-uBlurEdge,uBlurEdge*2.0,bDist);

  // Color field — sharp outside blur rect, 9-tap blurred inside
  vec3 col;
  if(blurMix>0.001){
    vec3 sharp=colorField(C);
    float r=uColorBlur;
    // 5-tap cross pattern (was 9-tap) — cheaper per fragment
    vec3 blurred = colorField(C)                   * 0.4;
    blurred += colorField(C+vec2( r, 0.0))         * 0.15;
    blurred += colorField(C+vec2(-r, 0.0))         * 0.15;
    blurred += colorField(C+vec2(0.0,  r))         * 0.15;
    blurred += colorField(C+vec2(0.0, -r))         * 0.15;
    col=mix(sharp,blurred,blurMix);
  } else {
    col=colorField(C);
  }

  // Grain — applied after blur so it stays sharp.
  // grainScale = size of each grain "cell" in canvas pixels.
  // Uses bilinear-interpolated value noise (smooth between cells),
  // so small grainScale values give fine soft noise rather than
  // hard per-pixel static.
  {
    vec2 gp = C / max(uGrainScale, 0.5);
    if(uGrainAnimated>0.5){ gp += vec2(iTime*3.0); }
    vec2 ip = floor(gp);
    vec2 fp = fract(gp);
    fp = fp*fp*(3.0-2.0*fp);
    float ga = fract(sin(dot(ip+vec2(0.0,0.0), vec2(12.9898,78.233))) * 43758.5453);
    float gb = fract(sin(dot(ip+vec2(1.0,0.0), vec2(12.9898,78.233))) * 43758.5453);
    float gc = fract(sin(dot(ip+vec2(0.0,1.0), vec2(12.9898,78.233))) * 43758.5453);
    float gd = fract(sin(dot(ip+vec2(1.0,1.0), vec2(12.9898,78.233))) * 43758.5453);
    float grain = mix(mix(ga,gb,fp.x), mix(gc,gd,fp.x), fp.y);
    col += (grain-0.5)*uGrainAmount;
  }

  // Post-processing
  col=(col-0.5)*uContrast+0.5;
  float luma=dot(col,vec3(0.2126,0.7152,0.0722));
  col=mix(vec3(luma),col,uSaturation);
  col=pow(max(col,0.0),vec3(1.0/max(uGamma,0.001)));
  col=clamp(col,0.0,1.0);

  float alpha=1.0;
  if(uMaskRect.z>0.0){
    vec2 mUv=C/iResolution.xy-0.5;
    float ar=iResolution.x/iResolution.y;
    mUv.x*=ar;
    // Expand the mask equidistantly (fixed UV units on all sides)
    // so a wide pill doesn't balloon horizontally under a percentage
    // expansion. Focus/pulse add the same absolute amount to both
    // halfSize.x and halfSize.y, giving a radial-like expansion.
    float expandPx = (uFocus*10.0 + uPulse*4.0) / iResolution.y;
    vec2 halfSize=uMaskRect.zw*0.5*vec2(ar,1.0) + vec2(expandPx, expandPx);
    float edgeSoft=uMaskEdge*(1.0+uFocus*0.3+uPulse*0.08);
    vec2 center=uMaskRect.xy*vec2(ar,1.0);

    // Brighten color in the mask on focus/pulse — a halo that raises
    // gradient lightness rather than expanding its footprint.
    col *= 1.0 + uFocus*0.25 + uPulse*0.1;

    // Soft pill envelope
    float d=sdRoundBox(mUv-center,halfSize,uMaskRadius);
    float envelope=1.0-S(-edgeSoft,edgeSoft*3.0,d);

    // Big wavelength noise — slow broad pushes that reshape the whole area
    float mt=iTime*uTimeSpeed;
    float big1=noise(mUv*2.4+vec2(mt*0.5,mt*0.35));
    float big2=noise(mUv*4.5-vec2(mt*0.4,mt*0.55));
    float bigWave=(big1*0.6+big2*0.4);

    // Warp the envelope — big, medium-big, and medium deformations
    float wBig1=(noise(mUv*2.0+vec2(mt*0.3,-mt*0.2))-0.5)*uMaskWarp*3.0;
    float wBig2=(noise(mUv*3.0-vec2(mt*0.25,mt*0.35))-0.5)*uMaskWarp*2.5;
    float wMedBig=(noise(mUv*6.5+vec2(-mt*0.5,mt*0.4))-0.5)*uMaskWarp*1.8;
    float wMed1=(noise(mUv*10.0-vec2(mt*0.6,-mt*0.5))-0.5)*uMaskWarp*1.2;
    float wMed2=(noise(mUv*15.0+vec2(mt*0.45,mt*0.7))-0.5)*uMaskWarp*0.8;
    float warpedD=d+wBig1+wBig2+wMedBig+wMed1+wMed2;
    float warpedEnvelope=1.0-S(-edgeSoft,edgeSoft*4.0,warpedD);

    // Detail noise — layered octaves
    float n1=noise(mUv*8.0+vec2(mt*0.7,mt*0.4));
    float n2=noise(mUv*14.0-vec2(mt*0.5,mt*0.8));
    float n3=noise(mUv*24.0+vec2(-mt*0.3,mt*0.9));
    float n4=noise(mUv*40.0-vec2(mt*0.4,-mt*0.6));
    float fine=n1*0.4+n2*0.3+n3*0.2+n4*0.1;
    fine=S(0.35,0.65,fine);

    // Combine: big waves modulate brightness
    float bigPush=S(0.35,0.65,bigWave);
    float molten=fine*bigPush;

    // Horizontal taper — dim the endpoints so corners don't hotspot
    float hDist=abs(mUv.x-center.x)/max(halfSize.x,0.001);
    float hTaper=1.0-S(0.5,1.2,hDist);

    // Raise floor + smooth — less alpha contrast, no full black holes
    float raw=molten*warpedEnvelope*hTaper;
    alpha=mix(0.4,1.0,clamp(raw,0.0,1.0));
    alpha*=warpedEnvelope;
    alpha=alpha*alpha*(3.0-2.0*alpha);
    alpha=alpha*alpha*(3.0-2.0*alpha);
  }
  o=vec4(col,alpha);
}
void main(){
  vec4 o=vec4(0.0);
  mainImage(o,gl_FragCoord.xy);
  fragColor=o;
}
`;

export interface GrainientProps {
  timeSpeed?: number;
  colorBalance?: number;
  warpStrength?: number;
  warpFrequency?: number;
  warpSpeed?: number;
  warpAmplitude?: number;
  blendAngle?: number;
  blendSoftness?: number;
  rotationAmount?: number;
  noiseScale?: number;
  grainAmount?: number;
  grainScale?: number;
  grainAnimated?: boolean;
  contrast?: number;
  gamma?: number;
  saturation?: number;
  centerX?: number;
  centerY?: number;
  zoom?: number;
  color1?: string;
  color2?: string;
  color3?: string;
  /** Optional 4th color — enables four-corner blend (top-R, top-L, bot-R, bot-L). */
  color4?: string;
  className?: string;
  /** Mask rounded rect: [centerX, centerY, width, height] in 0-1 UV space. 0,0 = center. */
  maskRect?: [number, number, number, number];
  /** Corner radius of mask pill in UV space */
  maskRadius?: number;
  /** Edge softness — how wide the falloff band is */
  maskEdge?: number;
  /** How much noise warps the mask boundary */
  maskWarp?: number;
  /** Overall intensity multiplier (0-2+). Animatable from outside. */
  intensity?: number;
  /** Ref for per-frame dynamic values: { mouse: [x,y], focus: 0-1, pulse: 0-1 } */
  dynamicRef?: React.RefObject<{
    mouse: [number, number];
    focus: number;
    pulse: number;
    /** Optional live maskRect override — [cx, cy, w, h] in 0-1 UV space. */
    maskRect?: [number, number, number, number];
  } | null>;
  /** Blur radius for color field in pixels (grain stays sharp). 0 = no blur. */
  colorBlur?: number;
  /** Rect where blur applies: [centerX, centerY, width, height] in 0-1 UV space. Omit to blur everywhere. */
  blurRect?: [number, number, number, number];
  /** How soft the blur region edge falloff is */
  blurEdge?: number;
}

function GrainientImpl({
  timeSpeed = 0.25,
  colorBalance = 0.0,
  warpStrength = 1.0,
  warpFrequency = 5.0,
  warpSpeed = 2.0,
  warpAmplitude = 50.0,
  blendAngle = 0.0,
  blendSoftness = 0.05,
  rotationAmount = 500.0,
  noiseScale = 2.0,
  grainAmount = 0.1,
  grainScale = 2.0,
  grainAnimated = false,
  contrast = 1.5,
  gamma = 1.0,
  saturation = 1.0,
  centerX = 0.0,
  centerY = 0.0,
  zoom = 0.9,
  color1 = "#FF9FFC",
  color2 = "#5227FF",
  color3 = "#B19EEF",
  color4 = "#000000",
  className = "",
  maskRect,
  maskRadius = 0.06,
  maskEdge = 0.01,
  maskWarp = 0.03,
  intensity = 1.0,
  dynamicRef,
  colorBlur = 0,
  blurRect,
  blurEdge = 0.03,
}: GrainientProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const intensityRef = useRef(intensity);
  useEffect(() => { intensityRef.current = intensity; }, [intensity]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Defer the WebGL init past the next paint so the page transition
    // (route change, sidebar selector animation, etc.) can land before
    // shader compilation blocks the main thread. Double-RAF gives us
    // one full frame of UI before heavy work kicks in.
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    const initRaf1 = requestAnimationFrame(() => {
      const initRaf2 = requestAnimationFrame(() => {
        if (cancelled || !containerRef.current) return;
        cleanup = init();
      });
      cleanup = () => cancelAnimationFrame(initRaf2);
    });

    function init(): () => void {
    const container = containerRef.current;
    if (!container) return () => {};
    let renderer: Renderer;
    try {
      renderer = new Renderer({
        webgl: 2,
        alpha: true,
        antialias: false,
        // Match the real device pixel density (accounts for zoom too)
        // so grain stays pixel-sharp at any zoom level.
        dpr: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
      });
    } catch {
      // No WebGL (e.g. jsdom in tests) — render nothing
      return () => {};
    }

    const gl = renderer.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    // Fade in the canvas after mount so it doesn't flash into existence
    canvas.style.opacity = "0";
    canvas.style.transition = "opacity 400ms ease-out";

    container.appendChild(canvas);

    // Kick off the fade-in on the next frame (after canvas has rendered
    // at least one frame at opacity 0, so the transition animates).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        canvas.style.opacity = "1";
      });
    });

    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new Float32Array([1, 1]) },
        uTimeSpeed: { value: timeSpeed },
        uColorBalance: { value: colorBalance },
        uWarpStrength: { value: warpStrength },
        uWarpFrequency: { value: warpFrequency },
        uWarpSpeed: { value: warpSpeed },
        uWarpAmplitude: { value: warpAmplitude },
        uBlendAngle: { value: blendAngle },
        uBlendSoftness: { value: blendSoftness },
        uRotationAmount: { value: rotationAmount },
        uNoiseScale: { value: noiseScale },
        uGrainAmount: { value: grainAmount },
        uGrainScale: { value: grainScale },
        uGrainAnimated: { value: grainAnimated ? 1.0 : 0.0 },
        uContrast: { value: contrast },
        uGamma: { value: gamma },
        uSaturation: { value: saturation },
        uCenterOffset: { value: new Float32Array([centerX, centerY]) },
        uZoom: { value: zoom },
        uColor1: { value: new Float32Array(hexToRgb(color1)) },
        uColor2: { value: new Float32Array(hexToRgb(color2)) },
        uColor3: { value: new Float32Array(hexToRgb(color3)) },
        uColor4: { value: new Float32Array(hexToRgb(color4)) },
        uMaskRect: { value: new Float32Array(maskRect ?? [0, 0, 0, 0]) },
        uMaskRadius: { value: maskRadius },
        uMaskEdge: { value: maskEdge },
        uMaskWarp: { value: maskWarp },
        uIntensity: { value: intensity },
        uMouse: { value: new Float32Array([-1, -1]) },
        uFocus: { value: 0 },
        uPulse: { value: 0 },
        uColorBlur: { value: colorBlur },
        uBlurRect: { value: new Float32Array(blurRect ?? [0, 0, 0, 0]) },
        uBlurEdge: { value: blurEdge },
      },
    });

    const mesh = new Mesh(gl, { geometry, program });

    // Batch rapid resize events (e.g. during a CSS transition firing
    // ResizeObserver many times per frame) into one setSize per frame.
    let resizeRaf = 0;
    const doResize = () => {
      resizeRaf = 0;
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      renderer.setSize(width, height);
      const res = program.uniforms.iResolution.value as Float32Array;
      res[0] = gl.drawingBufferWidth;
      res[1] = gl.drawingBufferHeight;
      // Render immediately so the resized canvas doesn't show a blank
      // frame between the setSize reset and the next render loop tick.
      renderer.render({ scene: mesh });
    };
    const setSize = () => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(doResize);
    };

    const ro = new ResizeObserver(setSize);
    ro.observe(container);
    doResize();

    let raf = 0;
    const t0 = performance.now();
    const dynRef = dynamicRef;
    const targetInterval = 1000 / 24; // 24 fps cap — cinematic motion, less GPU load
    let lastFrame = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - lastFrame < targetInterval) return;
      lastFrame = t;
      program.uniforms.iTime.value = (t - t0) * 0.001;
      program.uniforms.uIntensity.value = intensityRef.current;
      if (dynRef?.current) {
        const d = dynRef.current;
        const m = program.uniforms.uMouse.value as Float32Array;
        m[0] = d.mouse[0]; m[1] = d.mouse[1];
        program.uniforms.uFocus.value = d.focus;
        program.uniforms.uPulse.value = d.pulse;
        if (d.maskRect) {
          const mr = program.uniforms.uMaskRect.value as Float32Array;
          mr[0] = d.maskRect[0]; mr[1] = d.maskRect[1];
          mr[2] = d.maskRect[2]; mr[3] = d.maskRect[3];
        }
      }
      renderer.render({ scene: mesh });
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      try {
        container.removeChild(canvas);
      } catch {
        // already removed
      }
    };
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(initRaf1);
      cleanup?.();
    };
  }, [
    timeSpeed, colorBalance, warpStrength, warpFrequency, warpSpeed,
    warpAmplitude, blendAngle, blendSoftness, rotationAmount, noiseScale,
    grainAmount, grainScale, grainAnimated, contrast, gamma, saturation,
    centerX, centerY, zoom, color1, color2, color3, color4,
    maskRect, maskRadius, maskEdge, maskWarp, dynamicRef, intensity, colorBlur, blurRect, blurEdge,
  ]);

  return (
    <div
      ref={containerRef}
      className={className || undefined}
      style={{ width: "100%", height: "100%", overflow: "hidden" }}
    />
  );
}

// Memoized so parent re-renders (e.g. sidebar toggle propagating
// through context) don't cause this component to re-render. WebGL
// context stays alive across parent state changes.
export const Grainient = memo(GrainientImpl);
