export type Product = {
  id: string;
  name: string;
  category: "Tacos" | "Bebidas";
  priceCents: number;
  sortOrder: number;
  illustrationUrl: string;
  visualVersion: string;
};
export type Line = {
  productId: string;
  name: string;
  category: "Tacos" | "Bebidas";
  sortOrder: number;
  unitPriceCents: number;
  quantity: number;
  subtotalCents: number;
  illustrationUrl: string;
  visualVersion: string;
};
export type Cart = {
  id: string;
  status: "editable" | "confirmed";
  version: number;
  lines: Line[];
  totalCents: number;
  units: number;
  orderId: string | null;
};
export type Order = {
  id: string;
  cartId: string;
  status: "confirmed";
  createdAt: string;
  lines: Line[];
  totalCents: number;
  units: number;
};
export type Context = {
  cart: Cart;
  confirmedOrder: Order | null;
  lastConfirmedOrder: Order | null;
};
export type Operation = {
  endpoint: string;
  payload: {
    cartId: string;
    expectedVersion: number;
    idempotencyKey: string;
    productId?: string;
    operation?: "increment" | "set";
    quantity?: number;
  };
};
export type Problem = { code: string; message: string; fieldErrors?: Record<string, string> };
export const money = (cents: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2, minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
export const quantityError = "Escribe un número entero del 1 al 20.";
export const validQuantity = (raw: string) => /^(?:[1-9]|1[0-9]|20)$/.test(raw);

export class ApiError extends Error {
  constructor(public status: number, public problem: Problem, public context?: Context) {
    super(problem.message);
  }
}
export async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, data.error ?? { code: "SERVER_ERROR", message: "No pudimos completar la solicitud. Inténtalo de nuevo." }, data.context);
  return data as T;
}
