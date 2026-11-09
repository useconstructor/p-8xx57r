"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Menu, ShoppingBag, X } from "lucide-react";
import branding from "../../../branding.json";
import { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetDescription, SheetClose } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useSession } from "./session-provider";

export function Brand() {
  const words = branding.logoText.split(" ");
  return <Link className="brand" href="/" aria-label={`${branding.logoText}, inicio`}>
    <Image data-brand-logo src={branding.logoImageUrl || "/brand-mark.svg"} alt="" width={64} height={64} unoptimized />
    <span><span>{words[0]}</span><strong>{words.slice(1).join(" ")}</strong></span>
  </Link>;
}
export function usePublicHash() {
  const [hash, setHash] = useState("");
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    update();
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    window.addEventListener("tm-selection", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
      window.removeEventListener("tm-selection", update);
    };
  }, []);
  return hash;
}
export function trackStart() {
  (window as Window & { constructorTrack?: (name: string) => void }).constructorTrack?.("Pedido iniciado");
}
export function Header() {
  const pathname = usePathname();
  const hash = usePublicHash();
  const session = useSession();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const navigationClose = useRef(false);
  function activate(path: string) {
    navigationClose.current = true;
    setOpen(false);
    if (!open && pathname === path) window.dispatchEvent(new Event("tm-selection"));
  }
  const links = <>
    <Link href={`/${hash}`} aria-current={pathname === "/" ? "page" : undefined} onClick={() => activate("/")}>Menú</Link>
    <Link href={`/pedido${hash}`} aria-current={pathname === "/pedido" ? "page" : undefined} onClick={() => activate("/pedido")}>
      Mi pedido <ShoppingBag size={18} aria-hidden="true" />
      {session.context && session.state === "ready" && <span className="cart-count" aria-label={`${session.context.cart.units} productos en tu pedido`}>{session.context.cart.units}</span>}
    </Link>
  </>;
  return <header className="site-header">
    <div className="header-inner">
      <Brand />
      <nav className="desktop-nav" aria-label="Navegación principal">{links}</nav>
      <p className="demo-note">Demo ficticia de Esteban<br className="desktop-break" /> para probar Constructor</p>
      <Sheet open={open} onOpenChange={value => { if (value) navigationClose.current = false; setOpen(value); }}
        onOpenChangeComplete={value => { if (!value && navigationClose.current) window.dispatchEvent(new Event("tm-selection")); }}>
        <SheetTrigger ref={trigger} className="mobile-nav-trigger" aria-label="Abrir navegación"><Menu aria-hidden="true" /></SheetTrigger>
        <SheetContent className="navigation-sheet" showCloseButton={false} finalFocus={() => navigationClose.current ? false : trigger.current}
          onKeyDown={event => {
            if (event.key !== "Tab") return;
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),[tabindex="0"]')).filter(node => node.getClientRects().length && node.getAttribute("aria-hidden") !== "true");
            const first = items[0], last = items[items.length - 1];
            if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && (document.activeElement === last || !event.currentTarget.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
          }}>
          <div className="sheet-heading"><SheetTitle>Navegación</SheetTitle><SheetClose render={<Button variant="outline" aria-label="Cerrar navegación" />}><X aria-hidden="true" /></SheetClose></div>
          <SheetDescription>Explora el menú y consulta tu pedido de ejemplo.</SheetDescription>
          <nav aria-label="Navegación móvil">{links}</nav>
          <div className="sheet-brand"><Brand /><p>Sin cobros, preparación ni envío.</p></div>
        </SheetContent>
      </Sheet>
    </div>
  </header>;
}
export function Footer() {
  const hash = usePublicHash();
  const pathname = usePathname();
  const activate = (path: string) => { if (pathname === path) window.dispatchEvent(new Event("tm-selection")); };
  return <footer className="site-footer">
    <div className="footer-inner">
      <div><Brand /><p>Una comanda para explorar,<br />elegir y probar.</p></div>
      <nav aria-label="Navegación del pie"><h2>Navegación</h2><Link href={`/${hash}`} onClick={() => activate("/")}>Menú</Link><Link href={`/pedido${hash}`} onClick={() => activate("/pedido")}>Mi pedido <ArrowRight size={16} aria-hidden="true" /></Link></nav>
      <div><h2>Todo claro</h2><p>Precios de ejemplo en MXN.<br />De 1 a 20 por producto.<br />Sin cobros, preparación ni envío.</p></div>
    </div>
    <div className="footer-bottom"><span>{branding.logoText}</span><span>Identidad original propuesta · Productos ilustrados de ejemplo</span></div>
  </footer>;
}
