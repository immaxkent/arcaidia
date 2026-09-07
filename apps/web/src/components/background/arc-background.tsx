import { useEffect, useRef, useState } from "react";
import controlRoom from "@/assets/arcaidia-control-room.jpg";

export type SceneFocus = {
  x: number;
  y: number;
  z: number;
  illuminate: "none" | "source" | "arc" | "destination";
};

const DEFAULT_FOCUS: SceneFocus = { x: 0, y: 0, z: 6, illuminate: "none" };

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}


export function ArcBackground({
  dim = 1,
}: {
  dim?: number;
  focus?: SceneFocus;
}) {
  const reduced = useReducedMotion();
  const lightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduced) return undefined;
    const onMove = (e: PointerEvent) => {
      const el = document.documentElement;
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      el.style.setProperty("--mouse-x", `${x * 100}%`);
      el.style.setProperty("--mouse-y", `${y * 100}%`);
      el.style.setProperty("--scene-x", `${(x - 0.5) * -22}px`);
      el.style.setProperty("--scene-y", `${(y - 0.5) * -14}px`);
      if (lightRef.current) lightRef.current.style.opacity = "1";
    };
    const onLeave = () => {
      if (lightRef.current) lightRef.current.style.opacity = "0.45";
    };
    window.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [reduced]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-void">
      <img
        src={controlRoom}
        alt=""
        width={1920}
        height={1088}
        className="control-room-scene absolute -inset-6 size-[calc(100%+3rem)] object-cover"
        style={{ opacity: dim }}
      />
      <div className="absolute inset-0 bg-scene-wash" />
      <div ref={lightRef} className="pointer-lamp absolute inset-0" />
      <div className="absolute inset-0 opacity-25 halftone" />
      <div className="absolute inset-0 scanlines" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-scene-fade" />
    </div>
  );
}
