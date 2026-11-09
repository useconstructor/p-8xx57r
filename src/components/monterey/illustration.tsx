"use client";
/* Canonical SVG URLs and the retained native image node are required for resource recovery and addition motion. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

type IllustrationProps = {
  id: string; name: string; url: string; version: string; tick?: number; eager?: boolean; motionKey: string;
};
const consumedAdditions = new Map<string, number>();
export function Illustration(props: IllustrationProps) {
  return <IllustrationResource key={`${props.url}:${props.version}`} {...props} />;
}
function IllustrationResource({ id, name, url, version, tick = 0, eager = false, motionKey }: IllustrationProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const generation = useRef(0);
  const animation = useRef<Animation | null>(null);
  useEffect(() => {
    if (!tick || !loaded || !image.current || failed) return;
    animation.current?.cancel();
    const node = image.current;
    node.style.transform = "translateX(8px)";
    const consumed = consumedAdditions.get(motionKey) === tick;
    consumedAdditions.set(motionKey, tick);
    if (!consumed && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      animation.current = node.animate([{ transform: "translateX(0px)" }, { transform: "translateX(8px)" }], { duration: 160, easing: "ease-out" });
    }
    return () => { animation.current?.cancel(); };
  }, [tick, loaded, failed, motionKey]);
  async function retry() {
    if (retrying) return;
    setRetrying(true);
    try {
      const response = await fetch(url, { cache: "reload" });
      if (!response.ok) throw new Error("unavailable");
      setFailed(false);
      setLoaded(false);
      setAttempt(v => v + 1);
    } catch { setFailed(true); }
    finally { setRetrying(false); }
  }
  return <div className="illustration-frame" data-product-id={id} data-resource={url} data-visual-version={version}>
    {failed ? <div className="illustration-fallback" role="group" aria-label={`Ilustración de ${name}`}>
      <span>Ilustración no disponible</span>
      <Button type="button" variant="outline" onClick={retry} disabled={retrying} aria-label={`Reintentar ilustración de ${name}`}>
        <RotateCcw aria-hidden="true" />{retrying ? "Reintentando…" : "Reintentar"}
      </Button>
    </div> : <img
      key={`${url}:${version}:${attempt}`}
      ref={image}
      src={url}
      alt={`${name}, ilustración conceptual de ejemplo`}
      width={480}
      height={320}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onLoad={async event => {
        const node = event.currentTarget;
        const current = generation.current;
        try {
          await node.decode();
          if (generation.current === current && image.current === node) {
            if (node.naturalWidth > 0 && node.naturalHeight > 0) setLoaded(true);
            else setFailed(true);
          }
        } catch { if (generation.current === current && image.current === node) setFailed(true); }
      }}
      onError={() => setFailed(true)}
    />}
  </div>;
}
