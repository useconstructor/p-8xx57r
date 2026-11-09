"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, money, quantityError, validQuantity, type Line, type Order, type Product } from "@/lib/client/types";
import { useSelection } from "@/lib/client/selection";
import { Catalogue, useMenu } from "./catalogue";
import { Illustration } from "./illustration";
import { SessionStatus } from "./status";
import { useSession } from "./session-provider";
import { usePublicHash } from "./chrome";

export function OrderPage() {
  const s = useSession();
  const menu = useMenu();
  const { selection, select, ready: selectionReady, revision: selectionRevision } = useSelection(menu.products);
  const hash = usePublicHash();
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftsRef = useRef<Record<string, string>>({});
  const revisions = useRef<Record<string, number>>({});
  const savedRevisions = useRef<Record<string, number>>({});
  const previousLines = useRef<Line[]>([]);
  const previousCartId = useRef<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ id: string; revision: number } | null>(null);
  const fields = useRef<Record<string, HTMLInputElement | null>>({});
  const addTrigger = useRef<HTMLButtonElement>(null);
  const invalidReference = useRef<HTMLHeadingElement>(null);
  const catalogueHeading = useRef<HTMLHeadingElement>(null);
  const selectedHeading = useRef<HTMLHeadingElement>(null);
  const focusedSelectionRevision = useRef<number | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [historyOrder, setHistoryOrder] = useState<Order | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyRetry, setHistoryRetry] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const saves = useRef<Promise<boolean>>(Promise.resolve(true));
  const failedRemoval = useRef<string | null>(null);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const orderHeading = useRef<HTMLHeadingElement>(null);
  const context = s.context;
  const unresolvedConfirmation = s.unknown?.endpoint === "/api/orders";
  const confirmed = historyOrder ?? (!unresolvedConfirmation ? context?.confirmedOrder : null);
  const lines = confirmed?.lines ?? context?.cart.lines ?? [];
  const frozen = Boolean(confirmed);
  const total = confirmed?.totalCents ?? context?.cart.totalCents;
  const busy = s.busy || submitting;
  const recovery = Boolean(s.unknown || s.conflict);
  const stale = s.busy || Boolean(s.unknown || s.conflict) || lines.some(line => (drafts[line.productId] ?? String(line.quantity)) !== String(line.quantity));

  useLayoutEffect(() => {
    // Product fragments carry selection data, not a document scroll target.
    // Next leaves the previous route's offset intact for unmatched fragments.
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, []);
  const replaceDrafts = useCallback((next: Record<string, string>) => {
    draftsRef.current = next;
    setDrafts(next);
  }, []);
  useEffect(() => {
    if (!context) return;
    const next = { ...draftsRef.current };
    const changedCart = previousCartId.current !== null && previousCartId.current !== context.cart.id;
    if (changedCart && !s.unknown && !s.conflict) {
      for (const key of Object.keys(next)) delete next[key];
    }
    for (const line of context.cart.lines) {
      const previous = previousLines.current.find(item => item.productId === line.productId);
      if (next[line.productId] === undefined || next[line.productId] === String(previous?.quantity)) next[line.productId] = String(line.quantity);
    }
    if (!s.unknown && !s.conflict) {
      for (const id of Object.keys(next)) if (!context.cart.lines.some(line => line.productId === id)) delete next[id];
    }
    previousLines.current = context.cart.lines;
    previousCartId.current = context.cart.id;
    replaceDrafts(next);
  }, [context, replaceDrafts, s.unknown, s.conflict]);
  useEffect(() => {
    s.setDirty(Boolean(context?.cart.lines.some(line => (drafts[line.productId] ?? String(line.quantity)) !== String(line.quantity))));
    // The provider stores this in a ref; it does not publish a render.
  }, [drafts, context, s]);
  useEffect(() => () => s.setDirty(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.id === "lines") addTrigger.current?.focus();
    else if (focusRequest.id === "confirmation") confirmationHeading.current?.focus();
    else fields.current[focusRequest.id]?.focus();
  }, [focusRequest]);
  useEffect(() => {
    if (catalogueOpen) catalogueHeading.current?.focus();
  }, [catalogueOpen]);
  useEffect(() => {
    if (!selectionReady || focusedSelectionRevision.current === selectionRevision) return;
    focusedSelectionRevision.current = selectionRevision;
    if (!selection) invalidReference.current?.focus();
    else if (window.location.hash) {
      if (catalogueOpen) selectedHeading.current?.focus();
      else orderHeading.current?.focus({ preventScroll: true });
    }
  }, [selectionReady, selection, selectionRevision, catalogueOpen]);
  const historyGeneration = useRef(0);
  const loadHistory = useCallback(async () => {
    const generation = ++historyGeneration.current;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const result = await api<{ orders: Order[] }>("/api/orders");
      if (generation === historyGeneration.current) setOrders(result.orders);
    } catch { if (generation === historyGeneration.current) { setHistoryError("No pudimos cargar tus pedidos guardados."); setHistoryRetry(null); } }
    finally { if (generation === historyGeneration.current) setHistoryLoading(false); }
  }, []);
  useEffect(() => {
    // Load owned history after access or a new confirmation, never on history-loading publication.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (s.state === "ready" && context) void loadHistory();
  }, [s.state, context?.lastConfirmedOrder?.id, loadHistory]); // eslint-disable-line react-hooks/exhaustive-deps
  async function openOrder(id: string) {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const result = await api<{ order: Order }>(`/api/orders/${encodeURIComponent(id)}`);
      setHistoryOrder(result.order);
      setCatalogueOpen(false);
    } catch { setHistoryError("No pudimos abrir este pedido. Tu comanda actual sigue disponible."); setHistoryRetry(id); }
    finally { setHistoryLoading(false); }
  }
  useEffect(() => {
    if (historyOrder) confirmationHeading.current?.focus();
  }, [historyOrder]);

  function setRaw(id: string, raw: string) {
    revisions.current[id] = (revisions.current[id] ?? 0) + 1;
    replaceDrafts({ ...draftsRef.current, [id]: raw });
    setErrors(current => {
      const next = { ...current };
      if (validQuantity(raw)) delete next[id];
      else if (summary || current[id]) next[id] = quantityError;
      return next;
    });
    s.clearProblem();
  }
  function requestFocus(id: string) { setFocusRequest(previous => ({ id, revision: (previous?.revision ?? 0) + 1 })); }
  function validate(): boolean {
    const actual = s.current()?.cart.lines ?? [];
    const invalid: Record<string, string> = {};
    if (!actual.length) invalid.lines = "Añade al menos un producto para confirmar tu pedido de ejemplo.";
    actual.forEach(line => { if (!validQuantity(draftsRef.current[line.productId] ?? String(line.quantity))) invalid[line.productId] = quantityError; });
    setErrors(invalid);
    setSummary(Object.keys(invalid).length > 0);
    const first = Object.keys(invalid)[0];
    if (first) requestFocus(first);
    return !first;
  }
  function saveDraft(id: string, raw: string): Promise<boolean> {
    if (!validQuantity(raw)) {
      setErrors(current => ({ ...current, [id]: quantityError }));
      return Promise.resolve(false);
    }
    const revision = revisions.current[id] ?? 0;
    const task = async () => {
      if ((revisions.current[id] ?? 0) !== revision) return true;
      const current = s.current();
      if (!current || current.cart.status !== "editable") return false;
      // An edited draft still needs acknowledgement when it returns to the
      // saved quantity. Skip only revisions that have already been saved.
      if (current.cart.lines.find(line => line.productId === id)?.quantity === Number(raw) && revision <= (savedRevisions.current[id] ?? 0)) return true;
      const saved = await s.mutate("/api/cart/items", { productId: id, operation: "set", quantity: Number(raw) });
      if (!saved) return false;
      savedRevisions.current[id] = revision;
      if ((revisions.current[id] ?? 0) === revision) {
        const line = saved.cart.lines.find(item => item.productId === id);
        if (line) replaceDrafts({ ...draftsRef.current, [id]: String(line.quantity) });
      }
      return true;
    };
    saves.current = saves.current.then(task, task);
    return saves.current;
  }
  function step(line: Line, delta: number) {
    s.clearProblem();
    const raw = draftsRef.current[line.productId] ?? String(line.quantity);
    if (!validQuantity(raw)) { setErrors(current => ({ ...current, [line.productId]: quantityError })); requestFocus(line.productId); return; }
    const next = Number(raw) + delta;
    if (next < 1 || next > 20) {
      setErrors(current => ({ ...current, [line.productId]: next > 20 ? "El máximo es 20 por producto. Puedes quitarlo o elegir otro." : "El mínimo es 1. Para eliminarlo, usa Quitar." }));
      return;
    }
    setRaw(line.productId, String(next));
    void saveDraft(line.productId, String(next));
  }
  async function remove(line: Line) {
    failedRemoval.current = line.productId;
    const result = await s.mutate("/api/cart/remove", { productId: line.productId });
    if (result) {
      failedRemoval.current = null;
      setErrors(current => { const next = { ...current }; delete next[line.productId]; return next; });
      requestFocus(result.cart.lines[0]?.productId ?? "lines");
    }
  }
  async function add(product: Product) {
    const result = await s.mutate("/api/cart/items", { productId: product.id, operation: "increment", quantity: 1 });
    if (result) {
      const line = result.cart.lines.find(item => item.productId === product.id);
      if (line && (!draftsRef.current[product.id] || validQuantity(draftsRef.current[product.id]))) replaceDrafts({ ...draftsRef.current, [product.id]: String(line.quantity) });
      setErrors(current => { const next = { ...current }; delete next.lines; return next; });
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submittingRef.current || s.unknown || s.conflict || s.state !== "ready" || frozen) return;
    s.clearProblem();
    if (!validate()) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await saves.current;
      if (!validate()) return;
      for (const line of s.current()?.cart.lines ?? []) {
        if (!await saveDraft(line.productId, draftsRef.current[line.productId] ?? String(line.quantity))) return;
      }
      const result = await s.mutate("/api/orders");
      if (result?.confirmedOrder) {
        setSummary(false);
        setErrors({});
        setCatalogueOpen(false);
        requestFocus("confirmation");
      }
    } finally { submittingRef.current = false; setSubmitting(false); }
  }
  function useSavedDrafts() {
    const cart = s.current()?.cart;
    replaceDrafts(Object.fromEntries(cart?.lines.map(line => [line.productId, String(line.quantity)]) ?? []));
    setErrors({});
    setSummary(false);
    failedRemoval.current = null;
  }
  async function reapply() {
    const intended = { ...draftsRef.current };
    const next = s.rebase();
    if (!next || next.cart.status !== "editable") return;
    replaceDrafts(intended);
    const removingId = failedRemoval.current;
    if (failedRemoval.current) {
      const id = failedRemoval.current;
      if (next.cart.lines.some(line => line.productId === id)) {
        if (!await s.mutate("/api/cart/remove", { productId: id })) return;
      }
      failedRemoval.current = null;
    }
    const invalidId = Object.keys(intended).find(id => !validQuantity(intended[id]));
    if (invalidId) { setErrors({ [invalidId]: quantityError }); setSummary(true); requestFocus(invalidId); return; }
    for (const [id, raw] of Object.entries(intended)) {
      if (id === removingId) continue;
      if (!await saveDraft(id, raw)) return;
    }
  }
  async function startNew() {
    if (historyOrder && context?.cart.status === "editable") {
      setHistoryOrder(null);
      return;
    }
    const result = await s.mutate("/api/cart/new");
    if (result) { setHistoryOrder(null); replaceDrafts({}); setSummary(false); setErrors({}); setCatalogueOpen(false); requestFocus("lines"); }
  }
  return <main id="contenido" className="order-page page-width">
    <div className="order-intro"><Link href={`/${hash}`} className="back-link"><ArrowLeft size={18} aria-hidden="true" />Volver al menú</Link><h1 ref={orderHeading} tabIndex={-1}>Mi pedido</h1><p>Tu combinación, en una sola comanda.</p></div>
    {selectionReady && !selection && <div className="reference-notice" role="alert"><h2 tabIndex={-1} ref={invalidReference}>Referencia de producto inválida</h2><p>Tu comanda se conserva. Elige una referencia válida en el menú.</p><Button variant="outline" onClick={() => setCatalogueOpen(true)}>Elegir un producto</Button></div>}
    {historyOrder && <div className="history-view-note"><p>Estás viendo un pedido guardado.</p><Button variant="outline" onClick={() => setHistoryOrder(null)}>Volver a mi pedido</Button></div>}
    <form className={`comanda${recovery ? " comanda-recovering" : ""}${!lines.length ? " comanda-empty" : ""}`} aria-label="Comanda" onSubmit={submit} noValidate>
      <div className="comanda-lines">
        <div className="comanda-heading"><h2>{frozen ? "Tu comanda guardada" : "Tu comanda"}</h2>{context && <span>{confirmed?.units ?? context.cart.units} {(confirmed?.units ?? context.cart.units) === 1 ? "unidad" : "unidades"}</span>}</div>
        {s.state === "loading" && !context ? <div className="order-loading" role="status"><span className="pending-dot" />Cargando tu pedido…<div /><div /></div> :
          !context ? <div className="empty-order"><ShoppingBag size={48} aria-hidden="true" /><h3>Tu comanda está a salvo del otro lado</h3><p>Recupera el acceso para consultar o empezar tu pedido.</p></div> :
            !lines.length ? <div className="empty-order"><ShoppingBag size={48} aria-hidden="true" /><h3>Tu comanda empieza aquí</h3><p>Elige un taco, una bebida o tu propia combinación.</p></div> :
              lines.map((line, index) => <article className="order-line" key={`${confirmed?.cartId ?? context.cart.id}:${line.productId}`} aria-label={line.name} data-product-id={line.productId}>
                <div className="order-art"><Illustration id={line.productId} name={line.name} url={line.illustrationUrl} version={line.visualVersion} tick={s.additions[line.productId]} motionKey={`comanda:${confirmed?.cartId ?? context.cart.id}:${line.productId}`} eager={index === 0} /></div>
                <div className="line-information"><h3>{line.name}</h3><p>{money(line.unitPriceCents)} MXN <span>por unidad</span></p></div>
                <div className="line-edit">
                  {frozen ? <p className="frozen-quantity">Cantidad <strong>{line.quantity}</strong></p> :
                    <div className="quantity-field">
                      <label htmlFor={`quantity-${line.productId}`}>Cantidad de {line.name}</label>
                      <div className="quantity-control">
                        <Button type="button" variant="outline" data-quantity-action aria-label={`Reducir ${line.name}`} disabled={busy || s.state !== "ready" || Boolean(s.unknown || s.conflict)} onClick={() => step(line, -1)}><Minus aria-hidden="true" /></Button>
                        <Input ref={node => { fields.current[line.productId] = node; }} id={`quantity-${line.productId}`} type="text" inputMode="numeric" autoComplete="off"
                          value={drafts[line.productId] ?? String(line.quantity)} readOnly={submitting}
                          aria-invalid={Boolean(errors[line.productId])}
                          aria-describedby={errors[line.productId] ? `error-${line.productId}` : `quantity-help-${line.productId}`}
                          onChange={event => setRaw(line.productId, event.target.value)}
                          onBlur={event => {
                            const target = event.relatedTarget as HTMLElement | null;
                            if (target?.closest("[data-confirm],[data-quantity-action],[data-remove]") || s.unknown || s.conflict) return;
                            void saveDraft(line.productId, event.currentTarget.value);
                          }}
                          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (!s.unknown && !s.conflict) void saveDraft(line.productId, event.currentTarget.value); } }}
                        />
                        <Button type="button" variant="outline" data-quantity-action aria-label={`Aumentar ${line.name}`} disabled={busy || s.state !== "ready" || Boolean(s.unknown || s.conflict)} onClick={() => step(line, 1)}><Plus aria-hidden="true" /></Button>
                      </div>
                      <span id={`quantity-help-${line.productId}`} className="quantity-hint">De 1 a 20</span>
                    </div>}
                  <div className="line-subtotal"><span>{!frozen && (recovery || busy || (drafts[line.productId] ?? String(line.quantity)) !== String(line.quantity)) ? "Último subtotal válido" : "Subtotal"}</span><strong>{money(line.subtotalCents)} <small>MXN</small></strong></div>
                  {!frozen && <Button type="button" variant="ghost" data-remove className="remove-button" aria-label={`Quitar ${line.name}`} disabled={busy || s.state !== "ready" || Boolean(s.unknown || s.conflict)} onClick={() => void remove(line)}><Trash2 aria-hidden="true" />Quitar</Button>}
                </div>
                {errors[line.productId] && !frozen && <p id={`error-${line.productId}`} className="field-error">{errors[line.productId]}</p>}
              </article>)}
        {s.state === "ready" && context && !frozen && <div className="add-more"><Button ref={addTrigger} type="button" variant={lines.length ? "outline" : "default"} aria-expanded={catalogueOpen} aria-controls="secondary-catalogue" onClick={() => setCatalogueOpen(value => !value)}><Plus aria-hidden="true" />Añadir productos<ChevronDown aria-hidden="true" className={catalogueOpen ? "turned" : ""} /></Button></div>}
      </div>
      <aside className="comanda-edge" aria-label="Total y confirmación">
        {frozen && !s.unknown && <div className="confirmation-state" role="status"><span className="confirmation-icon"><Check aria-hidden="true" /></span><h2 tabIndex={-1} ref={confirmationHeading}>Pedido de ejemplo guardado</h2><p><time dateTime={confirmed!.createdAt}>{new Date(confirmed!.createdAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}</time></p></div>}
        <div className="order-total"><span>{stale && !frozen ? "Último total válido" : "Total"}</span><p>{total === undefined ? "—" : money(total)} <span>MXN</span></p></div>
        {!recovery && <SessionStatus />}
        {summary && Object.keys(errors).length > 0 && !frozen && <div className="validation-summary" role="alert"><h3>Revisa tu pedido</h3><ul>{Object.entries(errors).map(([id, error]) => <li key={id}><a href={id === "lines" ? "#secondary-catalogue" : `#quantity-${id}`} onClick={event => { event.preventDefault(); requestFocus(id); }}>{id === "lines" ? error : `${lines.find(line => line.productId === id)?.name ?? "Cantidad"}: ${error}`}</a></li>)}</ul></div>}
        {!frozen && <Button type="submit" data-confirm variant={!lines.length || recovery ? "outline" : "default"} className="confirm-button" disabled={busy || s.state !== "ready" || recovery}>{busy && s.state === "ready" ? "Guardando…" : "Confirmar pedido de ejemplo"}<Check aria-hidden="true" /></Button>}
        <p className="no-fulfillment">No se realizará ningún cobro, preparación ni envío.</p>
        {!frozen && !recovery && <p className="edge-note">Puedes revisar las cantidades antes de confirmar.</p>}
      </aside>
      {recovery && <div className="comanda-recovery"><SessionStatus localDrafts={drafts} onUseServer={useSavedDrafts} onReapply={() => void reapply()} onRecovered={() => {
        if (s.current()?.cart.status === "confirmed") { setCatalogueOpen(false); setSummary(false); setErrors({}); }
      }} /></div>}
    </form>
    {frozen && <div className="after-confirmation"><Button disabled={busy || Boolean(s.unknown || s.conflict)} onClick={() => void startNew()}>{historyOrder && context?.cart.status === "editable" ? "Volver a mi pedido" : "Empezar otro pedido"}<ArrowRight aria-hidden="true" /></Button><p>Los pedidos confirmados siguen disponibles en esta sesión.</p></div>}
    {catalogueOpen && !frozen && <section id="secondary-catalogue" className="secondary-catalogue" aria-label="Añadir productos">
      <div className="secondary-heading"><div><span className="eyebrow">Sigue eligiendo</span><h2 ref={catalogueHeading} tabIndex={-1}>Añadir productos</h2></div><Button variant="outline" onClick={() => { setCatalogueOpen(false); addTrigger.current?.focus(); }}>Cerrar catálogo</Button></div>
      {menu.loading ? <p role="status">Cargando menú…</p> : menu.error ? <div role="alert"><p>No pudimos cargar el menú.</p><Button onClick={() => void menu.retry()}>Reintentar menú</Button></div> : <>
        <h3 className="catalogue-selection" ref={selectedHeading} tabIndex={-1}>{selection ? `Seleccionado: ${selection.name}` : "Selecciona un producto válido"}</h3>
        <Catalogue products={menu.products} selected={selection} select={select} onAdd={add} compact />
      </>}
    </section>}
    <section className="order-history" aria-label="Pedidos guardados"><div className="history-heading"><h2>Pedidos guardados</h2><span>En esta sesión</span></div>
      {historyLoading ? <p role="status">Cargando pedidos guardados…</p> : historyError ? <div className="recovery-panel" role="alert"><p>{historyError}</p><Button variant="outline" onClick={() => historyRetry ? void openOrder(historyRetry) : void loadHistory()}>Reintentar</Button></div> :
        s.state !== "ready" ? <p>Recupera el acceso para consultar tu historial.</p> : !orders.length ? <p>Cuando confirmes un pedido de ejemplo, lo encontrarás aquí.</p> :
          <ul>{orders.map(order => <li key={order.id}><div><h3>Pedido de ejemplo</h3><time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}</time><p className="history-selection">{order.lines.map(line => `${line.quantity} × ${line.name}`).join(" · ")}</p></div><p>{order.units} {order.units === 1 ? "unidad" : "unidades"} · <strong>{money(order.totalCents)} MXN</strong></p><Button variant="outline" onClick={() => void openOrder(order.id)} aria-label={`Abrir pedido del ${new Date(order.createdAt).toLocaleString("es-MX")}`}>Abrir<ArrowRight aria-hidden="true" /></Button></li>)}</ul>}
    </section>
  </main>;
}
