"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { ArrowRight, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSelection } from "@/lib/client/selection";
import { money, type Product } from "@/lib/client/types";
import { Catalogue, useMenu } from "./catalogue";
import { Illustration } from "./illustration";
import { useSession } from "./session-provider";
import { SessionStatus } from "./status";
import { trackStart, usePublicHash } from "./chrome";

export function MenuPage() {
  const menu = useMenu();
  const session = useSession();
  const { selection, select, ready, revision } = useSelection(menu.products);
  const router = useRouter();
  const hash = usePublicHash();
  const selectionHeading = useRef<HTMLHeadingElement>(null);
  const invalidHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!ready) return;
    if (!selection) invalidHeading.current?.focus();
    else if (window.location.hash) selectionHeading.current?.focus({ preventScroll: revision <= 1 });
  }, [ready, selection, revision]);
  const blocked = session.state !== "ready" || session.busy || Boolean(session.unknown || session.conflict) || session.context?.cart.status === "confirmed";
  async function add(product: Product, navigate = false) {
    const result = await session.mutate("/api/cart/items", { productId: product.id, operation: "increment", quantity: 1 });
    if (result && navigate) router.push(`/pedido#producto=${product.id}`);
  }
  return <main id="contenido">
    <section className="poster" aria-label="Producto seleccionado">
      <div className="poster-inner">
        <div className="poster-title"><h1>Taquería<br className="phone-break" /> Monterey</h1><p>Ocho ejemplos. Muchas combinaciones.<br className="desktop-break" /> Arma una comanda a tu gusto.</p></div>
        <div className="poster-art">
          {menu.loading ? <div className="scene-loading" role="status">Cargando menú…</div> :
            menu.error ? <div className="scene-error" role="alert"><h2>No pudimos cargar el menú</h2><p>Vuelve a intentarlo para ver los productos de ejemplo.</p><Button variant="outline" onClick={() => void menu.retry()}>Reintentar menú</Button></div> :
              selection ? <Illustration key={selection.id} id={selection.id} name={selection.name} url={selection.illustrationUrl} version={selection.visualVersion} tick={session.additions[selection.id]} motionKey={`poster:${selection.id}`} eager /> :
                ready ? <div className="scene-error" role="alert"><h2 ref={invalidHeading} tabIndex={-1}>Referencia de producto inválida</h2><p>Selecciona un producto del menú para continuar.</p><a className="button-link outline" href="#menu" onClick={event => { event.preventDefault(); document.getElementById("menu")?.focus(); }}>Elegir un producto</a></div> : <div className="scene-loading">Cargando selección…</div>}
        </div>
        <span className="concept-caption">Ilustraciones conceptuales · Productos de ejemplo</span>
      </div>
      <div className="selection-band">
        <div className="selection-inner">
          <div className="selected-title">{selection && !menu.loading ? <><h2 ref={selectionHeading} tabIndex={-1}>{selection.name}</h2><span>{selection.category}</span></> : <h2>Tu próxima elección</h2>}</div>
          {selection && !menu.loading && <p className="hero-price">{money(selection.priceCents)} <span>MXN</span></p>}
          <div className="hero-actions">
            <Button disabled={blocked || !selection || menu.loading} onClick={() => { if (selection) { trackStart(); void add(selection, true); } }}>Añadir y ver pedido <ShoppingBag aria-hidden="true" /></Button>
            <Link className="button-link light-outline" href={`/pedido${hash}`} onClick={trackStart}>Armar pedido <ArrowRight size={18} aria-hidden="true" /></Link>
          </div>
        </div>
      </div>
    </section>
    <div className="page-width">
      <div className="home-status"><SessionStatus />
        {session.context?.cart.status === "confirmed" && !session.unknown && <p className="context-note">Tu último pedido está guardado. <Link href={`/pedido${hash}`}>Ábrelo y empieza otro pedido</Link> para añadir productos.</p>}
      </div>
      <section id="menu" tabIndex={-1} aria-label="Menú de ejemplo">
        {menu.error ? <div className="menu-load-error"><p>El menú todavía no está disponible.</p><Button variant="outline" onClick={() => void menu.retry()}>Reintentar menú</Button></div> : menu.loading ? <div className="catalogue-loading" aria-hidden="true"><div /><div /><div /></div> : <Catalogue products={menu.products} selected={selection} select={select} onAdd={product => add(product)} />}
      </section>
      <section className="menu-working-edge" aria-labelledby="how-heading">
        <div><h2 id="how-heading">Del menú a tu comanda</h2><p>Añade productos, ajusta de 1 a 20 unidades y confirma tu ejemplo. Puedes volver a abrirlo después.</p><p className="small-note">No se realizará ningún cobro, preparación ni envío.</p></div>
        <Link className="button-link" href={`/pedido${hash}`} onClick={trackStart}>Ir a mi pedido <ShoppingBag size={20} aria-hidden="true" /></Link>
      </section>
    </div>
  </main>;
}
