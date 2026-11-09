"use client";

import Link from "next/link";
import { AlertCircle, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "./session-provider";
import { money } from "@/lib/client/types";

export function SessionStatus({ localDrafts, onUseServer, onReapply, onRecovered }: {
  localDrafts?: Record<string, string>;
  onUseServer?: () => void;
  onReapply?: () => void;
  onRecovered?: (newIntent: boolean) => void;
}) {
  const s = useSession();
  if (s.state === "blocked") return <div className="recovery-panel" role="alert">
    <h3><AlertCircle aria-hidden="true" />No podemos acceder a tu sesión</h3>
    <p>{s.problem?.message ?? "Reintenta el acceso para consultar tu pedido."}</p>
    <div className="recovery-actions">
      <Button onClick={() => void s.initialize()}><RotateCcw aria-hidden="true" />Reintentar acceso</Button>
      <Button variant="outline" onClick={() => void s.initialize(true)}>Crear una sesión nueva</Button>
      {s.embedded && <a className="button-link outline" href="/pedido" target="_blank" rel="noopener">Abrir acceso directo</a>}
    </div>
    <p className="small-note">Una sesión nueva o el acceso directo no recuperan el historial perdido ni el de otra vista.</p>
  </div>;
  if (s.busy) return <p className="pending-status" role="status"><span className="pending-dot" />Guardando… Conservamos el último total válido.</p>;
  if (s.unknown) return <div className="recovery-panel" role="alert">
    <h3><AlertCircle aria-hidden="true" />{s.unknown.endpoint === "/api/orders" ? "Confirmación desconocida" : "Guardado desconocido"}</h3>
    <p>No sabemos si se guardó. Recupera el resultado del mismo envío antes de iniciar otro.</p>
    <p className="small-note">Conservamos el envío original y tu edición actual por separado.</p>
    <div className="recovery-actions">
      <Button disabled={s.state !== "ready"} onClick={async () => { if (await s.recover()) onRecovered?.(false); }}><RotateCcw aria-hidden="true" />Recuperar envío</Button>
      <Button variant="outline" disabled={s.state !== "ready"} onClick={async () => { if (await s.recover(true)) onRecovered?.(true); }}>Iniciar otro envío</Button>
    </div>
  </div>;
  if (s.conflict) return <div className="recovery-panel" role="alert">
    <h3><AlertCircle aria-hidden="true" />Tu pedido cambió en otra vista</h3>
    <p>Revisa tu edición y los valores guardados antes de decidir.</p>
    {s.rejectedIntent && <p>Cambio solicitado: {s.rejectedIntent.endpoint === "/api/cart/remove" ? "quitar el producto." : s.rejectedIntent.endpoint === "/api/orders" ? "confirmar el pedido." : s.rejectedIntent.payload.operation === "increment" ? "añadir una unidad del producto seleccionado." : `guardar la cantidad ${s.rejectedIntent.payload.quantity}.`}</p>}
    <div className="conflict-values">
      <div><h4>Tu edición</h4>{s.context?.cart.lines.length ? s.context.cart.lines.map(line => <p key={line.productId}>{line.name}: <strong>{localDrafts?.[line.productId] ?? line.quantity}</strong></p>) : <p>Sin productos.</p>}</div>
      <div><h4>Valores guardados</h4>{s.conflict.cart.lines.length ? s.conflict.cart.lines.map(line => <p key={line.productId}>{line.name}: <strong>{line.quantity}</strong></p>) : <p>Sin productos.</p>}<p>Total: {money(s.conflict.cart.totalCents)} MXN</p></div>
    </div>
    {s.conflict.lastConfirmedOrder && <p>Última confirmación: {money(s.conflict.lastConfirmedOrder.totalCents)} MXN · {new Date(s.conflict.lastConfirmedOrder.createdAt).toLocaleString("es-MX")}</p>}
    <div className="recovery-actions">
      <Button onClick={() => { s.chooseServer(); onUseServer?.(); }}>Usar valores guardados</Button>
      {onReapply && s.conflict.cart.status === "editable" && <Button variant="outline" onClick={onReapply}>Guardar mi edición</Button>}
      {!onReapply && s.rejectedIntent && s.conflict.cart.status === "editable" && <Button variant="outline" onClick={() => void s.reapplyIntent()}>Guardar mi edición</Button>}
    </div>
    {s.conflict.cart.status === "confirmed" && <p>El pedido ya está confirmado. Usa los valores guardados para abrirlo.</p>}
  </div>;
  if (s.problem) return <div className="recovery-panel" role="alert">
    <h3><AlertCircle aria-hidden="true" />No pudimos completar el cambio</h3>
    <p>{s.problem.message}</p>
    {s.problem.fieldErrors && <ul>{Object.entries(s.problem.fieldErrors).map(([key, reason]) => <li key={key}>{reason}</li>)}</ul>}
    <div className="recovery-actions"><Button variant="outline" onClick={s.clearProblem}>Volver a intentarlo</Button><Link className="text-link" href="/pedido">Abrir mi pedido</Link></div>
  </div>;
  if (s.notice) return <p className="saved-status" role="status"><Check aria-hidden="true" size={18} />{s.notice}</p>;
  return null;
}
