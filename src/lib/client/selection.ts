"use client";

import { useCallback, useEffect, useState } from "react";
import type { Product } from "./types";

export function readSelection(products: Product[]) {
  const hash = window.location.hash;
  if (!hash || hash === "#") return products.find(p => p.id === "pastor") ?? null;
  const match = /^#producto=([a-z0-9-]+)$/.exec(hash);
  return match ? products.find(p => p.id === match[1]) ?? null : null;
}
export function useSelection(products: Product[]) {
  const [selection, setSelection] = useState<Product | null>(null);
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const update = () => {
      setSelection(readSelection(products));
      setReady(products.length > 0);
      setRevision(v => v + 1);
    };
    update();
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    window.addEventListener("tm-selection", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
      window.removeEventListener("tm-selection", update);
    };
  }, [products]);
  const select = useCallback((product: Product) => {
    const hash = `#producto=${product.id}`;
    if (window.location.hash !== hash) window.history.pushState(null, "", window.location.pathname + window.location.search + hash);
    window.dispatchEvent(new Event("tm-selection"));
  }, []);
  return { selection, select, ready, revision };
}
