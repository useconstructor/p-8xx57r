"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type Context, type Operation, type Problem } from "@/lib/client/types";

const PENDING_KEY = "tm-pending-operation";
const ENDPOINTS = ["/api/cart/items", "/api/cart/remove", "/api/cart/new", "/api/orders"];
type SessionState = "loading" | "ready" | "blocked";
type SessionApi = {
  context: Context | null;
  current: () => Context | null;
  state: SessionState;
  embedded: boolean;
  busy: boolean;
  problem: Problem | null;
  unknown: Operation | null;
  conflict: Context | null;
  rejectedIntent: Operation | null;
  notice: string;
  additions: Record<string, number>;
  initialize: (createNew?: boolean) => Promise<void>;
  mutate: (endpoint: string, fields?: Partial<Operation["payload"]>) => Promise<Context | null>;
  recover: (newIntent?: boolean) => Promise<Context | null>;
  chooseServer: () => void;
  rebase: () => Context | null;
  reapplyIntent: () => Promise<Context | null>;
  clearProblem: () => void;
  setDirty: (dirty: boolean) => void;
  refresh: () => Promise<void>;
};
const SessionContext = createContext<SessionApi | null>(null);

// Markers are expectations only. They never authorize a read or contain session secrets.
function expectationScope() {
  if (window.top === window.self) return { key: "tm-session-expected:direct", embedded: false, ambiguous: false };
  let parentOrigin = "";
  try { parentOrigin = window.top!.location.origin; } catch { /* cross-origin parent */ }
  const ancestors = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  if (!parentOrigin && ancestors?.length) parentOrigin = ancestors.item(ancestors.length - 1) ?? "";
  return { key: parentOrigin ? `tm-session-expected:embedded:${parentOrigin}` : "tm-session-expected:embedded:unknown", embedded: true, ambiguous: !parentOrigin };
}
function markerExists(key: string) {
  try { return localStorage.getItem(key) === "expected"; } catch { return true; }
}
function markExpected(key: string) {
  try { localStorage.setItem(key, "expected"); } catch { /* authenticated read still establishes this view */ }
}
function loadOperation(): Operation | null {
  try {
    const text = sessionStorage.getItem(PENDING_KEY);
    if (!text) return null;
    const value = JSON.parse(text) as Operation;
    if (!ENDPOINTS.includes(value.endpoint) || !value.payload || typeof value.payload.idempotencyKey !== "string" || typeof value.payload.cartId !== "string" || !Number.isInteger(value.payload.expectedVersion)) return null;
    const allowed = new Set(["cartId", "expectedVersion", "idempotencyKey", "productId", "operation", "quantity"]);
    if (Object.keys(value.payload).some(key => !allowed.has(key))) return null;
    return value;
  } catch { return null; }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<Context | null>(null);
  const contextRef = useRef<Context | null>(null);
  const [state, setState] = useState<SessionState>("loading");
  const [embedded, setEmbedded] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const dirtyRef = useRef(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [unknown, setUnknown] = useState<Operation | null>(null);
  const unknownRef = useRef<Operation | null>(null);
  const [conflict, setConflict] = useState<Context | null>(null);
  const [rejectedIntent, setRejectedIntent] = useState<Operation | null>(null);
  const rejectedRef = useRef<Operation | null>(null);
  const conflictRef = useRef<Context | null>(null);
  const [notice, setNotice] = useState("");
  const [additions, setAdditions] = useState<Record<string, number>>({});
  const initializer = useRef<Promise<void> | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const apply = useCallback((value: Context) => {
    contextRef.current = value;
    setContext(value);
  }, []);
  const conflictWith = useCallback((value: Context | null) => {
    conflictRef.current = value;
    setConflict(value);
  }, []);
  const preserve = useCallback((value: Operation | null) => {
    if (value) sessionStorage.setItem(PENDING_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(PENDING_KEY);
    unknownRef.current = value;
    setUnknown(value);
  }, []);

  const initialize = useCallback((createNew = false, automatic = false) => {
    if (initializer.current) return initializer.current;
    const work = async () => {
      busyRef.current = true;
      setBusy(true);
      setState(previous => previous === "blocked" ? previous : "loading");
      setProblem(null);
      const scope = expectationScope();
      setEmbedded(scope.embedded);
      let lockEntered = false;
      let coordinationDenied = false;
      let recoveryAttempted = false;
      try {
        const coordinated = async () => {
          lockEntered = true;
          let authorized: Context;
          try {
            authorized = await api<Context>("/api/cart");
          } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 401) throw error;
            if (!createNew && (!automatic || scope.ambiguous || markerExists(scope.key) || markerExists("tm-session-expected") || Boolean(contextRef.current))) throw new Error("EXPECTED_SESSION_LOST");
            await api<Context>("/api/session", {});
            // The lock covers the authorized probe as well as initialization.
            authorized = await api<Context>("/api/cart");
          }
          markExpected(scope.key);
          if (dirtyRef.current && contextRef.current && (authorized.cart.id !== contextRef.current.cart.id || authorized.cart.version !== contextRef.current.cart.version)) conflictWith(authorized);
          else apply(authorized);
          setState("ready");
        };
        try {
          if (!navigator.locks?.request) {
            coordinationDenied = true;
            throw new Error("LOCKS_UNAVAILABLE");
          }
          await navigator.locks.request("tm-session-init", coordinated);
        } catch (error) {
          // Only an unavailable lock or a native permission denial before entry
          // permits this explicit attempt. Network/callback failures do not.
          coordinationDenied ||= !lockEntered && error instanceof DOMException && error.name === "SecurityError";
          if (!createNew || !coordinationDenied) throw error;
          recoveryAttempted = true;
          await api<Context>("/api/session", {});
          // A POST response is not evidence that the browser accepted its cookie.
          await api<Context>("/api/cart");
          // Even an isolated authorized read cannot make uncoordinated writes safe.
          throw new Error("LOCKS_UNAVAILABLE");
        }
      } catch (error) {
        setState("blocked");
        setProblem({ code: "SESSION_BLOCKED", message: recoveryAttempted && error instanceof ApiError && error.status === 401
          ? "La sesión no quedó accesible: el navegador sigue bloqueando la cookie de sesión. Habilita los permisos del sitio o prueba el acceso directo."
          : coordinationDenied
            ? "Este navegador no permite coordinar el acceso entre vistas. No podemos habilitar tu pedido con seguridad. Habilita los permisos del sitio o prueba el acceso directo en un navegador compatible."
            : "No podemos acceder a tu sesión. Reintenta el acceso o crea una sesión nueva; una sesión nueva no recupera el historial anterior." });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    };
    initializer.current = work().finally(() => { initializer.current = null; });
    return initializer.current;
  }, [apply, conflictWith]);

  const refresh = useCallback(async () => {
    if (!contextRef.current || busyRef.current || unknownRef.current) return;
    try {
      const next = await api<Context>("/api/cart");
      if (busyRef.current || unknownRef.current) return;
      const current = contextRef.current;
      if (current && (next.cart.id !== current.cart.id || next.cart.version !== current.cart.version)) {
        conflictWith(next);
        setNotice("");
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setState("blocked");
        setProblem({ code: "SESSION_BLOCKED", message: "No podemos acceder a tu sesión. Una sesión nueva no recupera el historial anterior." });
      }
    }
  }, [conflictWith]);
  useEffect(() => {
    const saved = loadOperation();
    unknownRef.current = saved;
    // Hydrate only the recovery envelope from browser storage, not order data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUnknown(saved);
    void initialize(false, true);
    try {
      channel.current = new BroadcastChannel("tm-cart-updated");
      channel.current.onmessage = () => void refresh();
    } catch { /* focus refresh remains available */ }
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => { channel.current?.close(); window.removeEventListener("focus", focus); };
  }, [initialize, refresh]);

  const send = useCallback(async (operation: Operation, replay = false): Promise<Context | null> => {
    if (busyRef.current || state !== "ready") return null;
    busyRef.current = true;
    setBusy(true);
    setNotice("");
    setProblem(null);
    try {
      // Persist the exact outgoing intent before it can reach the network.
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(operation));
    } catch {
      setProblem({ code: "STORAGE_BLOCKED", message: "No podemos conservar este envío para recuperarlo. Habilita el almacenamiento de esta sesión y vuelve a intentarlo." });
      busyRef.current = false;
      setBusy(false);
      return null;
    }
    let mutationAccepted = false;
    try {
      const saved = await api<Context>(operation.endpoint, operation.payload);
      mutationAccepted = true;
      // Fresh writes already return their authorized totals. Only a replay can
      // return an earlier result that must be reconciled before adoption.
      if (replay) {
        const latest = await api<Context>("/api/cart");
        if (latest.cart.id !== saved.cart.id || latest.cart.version > saved.cart.version) {
          preserve(null);
          rejectedRef.current = null;
          setRejectedIntent(null);
          conflictWith(latest);
          channel.current?.postMessage("updated");
          return null;
        }
      }
      preserve(null);
      apply(saved);
      conflictWith(null);
      rejectedRef.current = null;
      setRejectedIntent(null);
      if (operation.endpoint === "/api/cart/items" && operation.payload.operation === "increment") {
        const id = operation.payload.productId!;
        setAdditions(previous => ({ ...previous, [id]: (previous[id] ?? 0) + 1 }));
        setNotice(`${saved.cart.lines.find(line => line.productId === id)?.name ?? "Producto"} añadido a tu pedido.`);
      } else if (operation.endpoint === "/api/orders") setNotice("");
      else setNotice(operation.endpoint === "/api/cart/new" ? "Tu nuevo pedido está listo para empezar." : "Cambios guardados.");
      channel.current?.postMessage("updated");
      return saved;
    } catch (error) {
      if (!mutationAccepted && error instanceof ApiError && error.status < 500) {
        preserve(null);
        setProblem(error.problem);
        if (error.context) {
          conflictWith(error.context);
          rejectedRef.current = operation;
          setRejectedIntent(operation);
        }
        if (error.status === 401) setState("blocked");
      } else {
        preserve(operation);
        if (error instanceof ApiError && error.status === 401) setState("blocked");
      }
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [apply, conflictWith, preserve, state]);

  const mutate = useCallback(async (endpoint: string, fields: Partial<Operation["payload"]> = {}) => {
    const current = contextRef.current;
    if (!current || busyRef.current || unknownRef.current || conflictRef.current || state !== "ready") return null;
    return send({
      endpoint,
      payload: { ...fields, cartId: current.cart.id, expectedVersion: current.cart.version, idempotencyKey: crypto.randomUUID() },
    });
  }, [send, state]);
  const recover = useCallback(async (newIntent = false) => {
    const operation = unknownRef.current;
    if (!operation || busyRef.current || state !== "ready") return null;
    const result = await send(operation, true);
    if (result && newIntent) {
      setNotice(result.cart.status === "confirmed" ? "El envío original está guardado. Empieza otro pedido para crear uno diferente." : "Envío original recuperado. Revisa tu edición antes de guardarla como un envío nuevo.");
    }
    return result;
  }, [send, state]);
  const chooseServer = useCallback(() => {
    if (conflictRef.current) apply(conflictRef.current);
    conflictWith(null);
    setProblem(null);
    setNotice("Se muestran los valores guardados.");
    rejectedRef.current = null;
    setRejectedIntent(null);
  }, [apply, conflictWith]);
  const rebase = useCallback(() => {
    const next = conflictRef.current;
    if (next) apply(next);
    conflictWith(null);
    setProblem(null);
    return next;
  }, [apply, conflictWith]);
  const reapplyIntent = useCallback(async () => {
    const previous = rejectedRef.current;
    const next = conflictRef.current;
    if (!previous || !next || next.cart.status !== "editable" || busyRef.current) return null;
    apply(next);
    conflictWith(null);
    return send({ endpoint: previous.endpoint, payload: { ...previous.payload, cartId: next.cart.id, expectedVersion: next.cart.version, idempotencyKey: crypto.randomUUID() } });
  }, [apply, conflictWith, send]);
  return <SessionContext.Provider value={{
    context, current: () => contextRef.current, state, embedded, busy, problem, unknown, conflict, rejectedIntent, notice, additions,
    initialize, mutate, recover, chooseServer, rebase, reapplyIntent, refresh,
    clearProblem: () => { setProblem(null); setNotice(""); },
    setDirty: dirty => { dirtyRef.current = dirty; },
  }}>{children}</SessionContext.Provider>;
}
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("SessionProvider missing");
  return value;
}
