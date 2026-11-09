import "server-only";

export type Product = {
  id: string;
  name: string;
  category: "Tacos" | "Bebidas";
  priceCents: number;
  sortOrder: number;
  illustrationUrl: string;
  visualVersion: string;
};

export type Line = Omit<Product, "id" | "priceCents"> & {
  productId: string;
  unitPriceCents: number;
  quantity: number;
  subtotalCents: number;
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

export type Envelope = {
  cartId: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type Mutation = "items" | "remove" | "new" | "confirm";
export type MutationInput = Envelope & {
  productId?: string;
  operation?: "increment" | "set";
  quantity?: number;
};
