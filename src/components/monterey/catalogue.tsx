"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, ShoppingBag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, money, type Product } from "@/lib/client/types";
import { Illustration } from "./illustration";
import { useSession } from "./session-provider";

export function useMenu() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await api<{ products: Product[] }>("/api/menu");
      setProducts(result.products.sort((a, b) => a.sortOrder - b.sortOrder));
    } catch { setError(true); }
    finally { setLoading(false); }
  }, []);
  // Initial public request; state changes also describe explicit user retries.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  return { products, loading, error, retry: load };
}
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX");
export function Catalogue({ products, selected, select, onAdd, compact = false }: {
  products: Product[]; selected: Product | null; select: (product: Product) => void;
  onAdd: (product: Product) => Promise<void>; compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todo");
  const session = useSession();
  const filtered = products.filter(product => (category === "Todo" || product.category === category) && normalize(product.name).includes(normalize(query)));
  const blocked = !selected || session.busy || session.state !== "ready" || Boolean(session.unknown || session.conflict) || session.context?.cart.status === "confirmed";
  return <div className={`catalogue ${compact ? "catalogue-secondary" : ""}`}>
    <div className="catalogue-tools">
      <div className="search-field">
        <label htmlFor={compact ? "order-search" : "menu-search"}>Buscar productos</label>
        <div className="search-input"><Search size={22} aria-hidden="true" /><Input id={compact ? "order-search" : "menu-search"} value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar productos…" type="search" autoComplete="off" />{query && <Button variant="ghost" aria-label="Limpiar búsqueda" onClick={() => setQuery("")}><X size={18} aria-hidden="true" /></Button>}</div>
      </div>
      <div className="category-filters" role="group" aria-label="Filtrar por categoría">{["Todo", "Tacos", "Bebidas"].map(name => <Button key={name} variant="outline" aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</Button>)}</div>
    </div>
    {!filtered.length ? <div className="no-results" role="status"><h3>No encontramos productos</h3><p>Prueba otro nombre o vuelve a ver el menú completo.</p><div><Button variant="outline" onClick={() => setQuery("")}>Limpiar búsqueda</Button><Button variant="outline" onClick={() => setCategory("Todo")}>Todo</Button></div></div> :
      ["Tacos", "Bebidas"].map(name => {
        const items = filtered.filter(p => p.category === name);
        if (!items.length) return null;
        return <section className="menu-category" key={name} aria-labelledby={`${compact ? "secondary-" : ""}${name.toLowerCase()}`}>
          <div className="category-title"><h2 id={`${compact ? "secondary-" : ""}${name.toLowerCase()}`}>{name}</h2><span>Productos de ejemplo</span></div>
          <div className="product-rows">
            {items.map(product => <article className="product-row" key={product.id} data-product-id={product.id} aria-label={product.name} data-selected={selected?.id === product.id}>
              <div className="product-art"><Illustration id={product.id} name={product.name} url={product.illustrationUrl} version={product.visualVersion} tick={session.additions[product.id]} motionKey={`catalogue:${product.id}`} /></div>
              <div className="product-details"><h3>{product.name}</h3><p className="product-price">{money(product.priceCents)} <span>MXN</span></p></div>
              <div className="product-actions"><Button variant="outline" aria-label={`Seleccionar ${product.name}`} aria-pressed={selected?.id === product.id} onClick={() => select(product)}>Seleccionar</Button><Button aria-label={`Añadir ${product.name}`} disabled={blocked} onClick={() => void onAdd(product)}>Añadir <ShoppingBag aria-hidden="true" /></Button></div>
            </article>)}
          </div>
        </section>;
      })}
  </div>;
}
