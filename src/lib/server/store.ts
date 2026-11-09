import "server-only";
import { randomUUID } from "node:crypto";
import type { Row, Transaction } from "@libsql/client";
import { db } from "@/lib/db";
import { ensureSchema } from "./schema";
import { runTransaction } from "./transactions";
import {
  ApiError, invalid, missing, newSecret, payloadHash, sessionRequired, tokenHash,
} from "./http";
import type { Context, Line, Mutation, MutationInput, Order, Product } from "./types";

type Owner = { id: string; currentCartId: string };

async function transaction<T>(mode: "read" | "write", action: (tx: Transaction) => Promise<T>): Promise<T> {
  await ensureSchema();
  return runTransaction(mode, action);
}

function product(row: Row): Product {
  return {
    id: String(row.id),
    name: String(row.name),
    category: row.category as Product["category"],
    priceCents: Number(row.price_cents),
    sortOrder: Number(row.sort_order),
    illustrationUrl: String(row.illustration_url),
    visualVersion: String(row.visual_version),
  };
}

function frozenLine(row: Row): Line {
  return {
    productId: String(row.product_id),
    name: String(row.name),
    category: row.category as Product["category"],
    sortOrder: Number(row.sort_order),
    unitPriceCents: Number(row.unit_price_cents),
    quantity: Number(row.quantity),
    subtotalCents: Number(row.subtotal_cents),
    illustrationUrl: String(row.illustration_url),
    visualVersion: String(row.visual_version),
  };
}

async function findOwner(tx: Transaction, digest: string): Promise<Owner | null> {
  const result = await tx.execute({
    sql: "SELECT id,current_cart_id FROM sesiones WHERE token_hash=?",
    args: [digest],
  });
  const row = result.rows[0];
  return row ? { id: String(row.id), currentCartId: String(row.current_cart_id) } : null;
}

async function requireOwner(tx: Transaction, digest: string): Promise<Owner> {
  const owner = await findOwner(tx, digest);
  if (!owner) sessionRequired();
  return owner;
}

function requireDigest(request: Request): string {
  const digest = tokenHash(request);
  if (!digest) sessionRequired();
  return digest;
}

async function orderFromRow(tx: Transaction, row: Row): Promise<Order> {
  const result = await tx.execute({
    sql: "SELECT * FROM pedido_lineas WHERE order_id=? ORDER BY sort_order,product_id",
    args: [row.id],
  });
  return {
    id: String(row.id),
    cartId: String(row.cart_id),
    status: "confirmed",
    createdAt: String(row.created_at),
    totalCents: Number(row.total_cents),
    units: Number(row.units),
    lines: result.rows.map(frozenLine),
  };
}

async function ownedOrder(tx: Transaction, ownerId: string, orderId: string): Promise<Order> {
  const result = await tx.execute({
    sql: "SELECT * FROM pedidos WHERE id=? AND session_id=?",
    args: [orderId, ownerId],
  });
  if (!result.rows[0]) missing();
  return orderFromRow(tx, result.rows[0]);
}

async function editableLines(tx: Transaction, cartId: string): Promise<Line[]> {
  const result = await tx.execute({
    sql: `SELECT p.*,l.quantity FROM carrito_lineas l
      JOIN productos p ON p.id=l.product_id WHERE l.cart_id=?
      ORDER BY p.sort_order,p.id`,
    args: [cartId],
  });
  return result.rows.map((row) => {
    const p = product(row);
    const quantity = Number(row.quantity);
    return {
      productId: p.id,
      name: p.name,
      category: p.category,
      sortOrder: p.sortOrder,
      unitPriceCents: p.priceCents,
      quantity,
      subtotalCents: p.priceCents * quantity,
      illustrationUrl: p.illustrationUrl,
      visualVersion: p.visualVersion,
    };
  });
}

function totals(lines: Line[]) {
  return {
    totalCents: lines.reduce((sum, line) => sum + line.subtotalCents, 0),
    units: lines.reduce((sum, line) => sum + line.quantity, 0),
  };
}

async function context(tx: Transaction, owner: Owner): Promise<Context> {
  const result = await tx.execute({
    sql: "SELECT * FROM carritos WHERE id=? AND session_id=?",
    args: [owner.currentCartId, owner.id],
  });
  const row = result.rows[0];
  if (!row) throw new Error("Missing session cart");
  const confirmedOrder = row.order_id ? await ownedOrder(tx, owner.id, String(row.order_id)) : null;
  // Always use the immutable snapshot for a confirmed cart, even if the
  // editable catalogue later acquires a new price, name or visual resource.
  const lines = confirmedOrder?.lines ?? await editableLines(tx, String(row.id));
  const latest = await tx.execute({
    sql: "SELECT * FROM pedidos WHERE session_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
    args: [owner.id],
  });
  const lastConfirmedOrder = latest.rows[0]
    ? confirmedOrder?.id === latest.rows[0].id
      ? confirmedOrder
      : await orderFromRow(tx, latest.rows[0])
    : null;
  return {
    cart: {
      id: String(row.id),
      status: row.status as Context["cart"]["status"],
      version: Number(row.version),
      lines,
      ...totals(lines),
      orderId: row.order_id === null ? null : String(row.order_id),
    },
    confirmedOrder,
    lastConfirmedOrder,
  };
}

export async function readMenu() {
  await ensureSchema();
  const result = await db.execute("SELECT * FROM productos ORDER BY sort_order,id");
  return { products: result.rows.map(product) };
}

export async function initializeSession(request: Request): Promise<{ context: Context; secret?: string }> {
  const digest = tokenHash(request);
  return transaction("write", async (tx) => {
    const existing = digest ? await findOwner(tx, digest) : null;
    if (existing) return { context: await context(tx, existing) };

    const owner = { id: randomUUID(), currentCartId: randomUUID() };
    const credentials = newSecret();
    const now = new Date().toISOString();
    await tx.execute({
      sql: "INSERT INTO sesiones (id,token_hash,current_cart_id,created_at) VALUES (?,?,NULL,?)",
      args: [owner.id, credentials.digest, now],
    });
    await tx.execute({
      sql: "INSERT INTO carritos (id,session_id,status,version,created_at) VALUES (?,?,'editable',0,?)",
      args: [owner.currentCartId, owner.id, now],
    });
    await tx.execute({
      sql: "UPDATE sesiones SET current_cart_id=? WHERE id=?",
      args: [owner.currentCartId, owner.id],
    });
    return { context: await context(tx, owner), secret: credentials.secret };
  });
}

export async function readCart(request: Request): Promise<Context> {
  const digest = requireDigest(request);
  return transaction("read", async (tx) => context(tx, await requireOwner(tx, digest)));
}

export async function readOrders(request: Request) {
  const digest = requireDigest(request);
  return transaction("read", async (tx) => {
    const owner = await requireOwner(tx, digest);
    const rows = await tx.execute({
      sql: "SELECT * FROM pedidos WHERE session_id=? ORDER BY created_at DESC,rowid DESC",
      args: [owner.id],
    });
    const orders: Order[] = [];
    for (const row of rows.rows) orders.push(await orderFromRow(tx, row));
    return { orders };
  });
}

export async function readOrder(request: Request, id: string) {
  const digest = requireDigest(request);
  return transaction("read", async (tx) => {
    const owner = await requireOwner(tx, digest);
    // Arbitrary identifiers still use the same private not-found response.
    return { order: await ownedOrder(tx, owner.id, id) };
  });
}

async function conflict(tx: Transaction, owner: Owner, code: string, message: string): Promise<never> {
  throw new ApiError(409, code, message, {}, await context(tx, owner));
}

export async function mutate(
  request: Request,
  kind: Mutation,
  endpoint: string,
  body: MutationInput,
): Promise<Context> {
  const digest = requireDigest(request);
  const fingerprint = payloadHash(body);
  return transaction("write", async (tx) => {
    const owner = await requireOwner(tx, digest);
    const previous = await tx.execute({
      sql: `SELECT endpoint,payload_hash,response_json FROM operaciones_idempotentes
        WHERE session_id=? AND idempotency_key=?`,
      args: [owner.id, body.idempotencyKey],
    });
    if (previous.rows[0]) {
      const row = previous.rows[0];
      if (row.endpoint !== endpoint || row.payload_hash !== fingerprint) {
        throw new ApiError(409, "IDEMPOTENCY_CONFLICT",
          "Este envío ya tiene otros datos. Recupera su resultado antes de iniciar otro.");
      }
      // Replay precedes version/current-cart checks: a later cart must not
      // prevent reconciliation of an earlier successfully committed operation.
      return JSON.parse(String(row.response_json)) as Context;
    }

    const cartResult = await tx.execute({
      sql: "SELECT * FROM carritos WHERE id=? AND session_id=?",
      args: [body.cartId, owner.id],
    });
    const cart = cartResult.rows[0];
    if (!cart) missing();
    if (owner.currentCartId !== body.cartId || Number(cart.version) !== body.expectedVersion) {
      return conflict(tx, owner, "VERSION_CONFLICT", "Tu pedido cambió. Revisa los valores guardados.");
    }
    if (kind === "new" && cart.status !== "confirmed") {
      return conflict(tx, owner, "CART_EDITABLE", "Ya tienes un pedido editable.");
    }
    if (kind !== "new" && cart.status !== "editable") {
      return conflict(tx, owner, "CART_CONFIRMED", "Este pedido ya está guardado.");
    }

    if (kind === "items" || kind === "remove") {
      const found = await tx.execute({
        sql: "SELECT id FROM productos WHERE id=?",
        args: [body.productId!],
      });
      if (!found.rows[0]) invalid("productId", "Selecciona un producto válido.", "INVALID_PRODUCT");
      const line = await tx.execute({
        sql: "SELECT quantity FROM carrito_lineas WHERE cart_id=? AND product_id=?",
        args: [body.cartId, body.productId!],
      });
      if (kind === "remove") {
        if (!line.rows[0]) invalid("productId", "El producto no está en tu pedido.", "INVALID_PRODUCT");
        await tx.execute({
          sql: "DELETE FROM carrito_lineas WHERE cart_id=? AND product_id=?",
          args: [body.cartId, body.productId!],
        });
      } else {
        const quantity = body.operation === "set"
          ? body.quantity!
          : Number(line.rows[0]?.quantity ?? 0) + body.quantity!;
        if (quantity > 20) invalid("quantity", "Escribe un número entero del 1 al 20.", "QUANTITY_RANGE");
        await tx.execute({
          sql: `INSERT INTO carrito_lineas (cart_id,product_id,quantity) VALUES (?,?,?)
            ON CONFLICT(cart_id,product_id) DO UPDATE SET quantity=excluded.quantity`,
          args: [body.cartId, body.productId!, quantity],
        });
      }
      await bump(tx, owner, body);
    } else if (kind === "confirm") {
      const lines = await editableLines(tx, body.cartId);
      if (!lines.length) invalid("lines", "Añade al menos un producto.", "EMPTY_CART");
      const total = totals(lines);
      const orderId = randomUUID();
      const now = new Date().toISOString();
      await tx.execute({
        sql: `INSERT INTO pedidos (id,cart_id,session_id,status,created_at,total_cents,units)
          VALUES (?,?,?,'confirmed',?,?,?)`,
        args: [orderId, body.cartId, owner.id, now, total.totalCents, total.units],
      });
      for (const line of lines) {
        await tx.execute({
          sql: `INSERT INTO pedido_lineas
            (order_id,product_id,name,category,sort_order,unit_price_cents,quantity,
             subtotal_cents,illustration_url,visual_version) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          args: [orderId, line.productId, line.name, line.category, line.sortOrder,
            line.unitPriceCents, line.quantity, line.subtotalCents, line.illustrationUrl, line.visualVersion],
        });
      }
      const updated = await tx.execute({
        sql: `UPDATE carritos SET status='confirmed',order_id=?,version=version+1
          WHERE id=? AND session_id=? AND version=? AND status='editable'`,
        args: [orderId, body.cartId, owner.id, body.expectedVersion],
      });
      if (updated.rowsAffected !== 1) {
        return conflict(tx, owner, "VERSION_CONFLICT", "Tu pedido cambió. Revisa los valores guardados.");
      }
    } else {
      // This is the only path that creates a subsequent cart. The old cart
      // and every saved order remain intact.
      await bump(tx, owner, body);
      const newCartId = randomUUID();
      await tx.execute({
        sql: "INSERT INTO carritos (id,session_id,status,version,created_at) VALUES (?,?,'editable',0,?)",
        args: [newCartId, owner.id, new Date().toISOString()],
      });
      const updated = await tx.execute({
        sql: "UPDATE sesiones SET current_cart_id=? WHERE id=? AND current_cart_id=?",
        args: [newCartId, owner.id, body.cartId],
      });
      if (updated.rowsAffected !== 1) throw new Error("Session context changed");
      owner.currentCartId = newCartId;
    }

    const result = await context(tx, owner);
    await tx.execute({
      sql: `INSERT INTO operaciones_idempotentes
        (session_id,idempotency_key,endpoint,payload_hash,response_status,response_json,created_at)
        VALUES (?,?,?,?,200,?,?)`,
      args: [owner.id, body.idempotencyKey, endpoint, fingerprint, JSON.stringify(result), new Date().toISOString()],
    });
    return result;
  });
}

async function bump(tx: Transaction, owner: Owner, body: MutationInput) {
  const updated = await tx.execute({
    sql: "UPDATE carritos SET version=version+1 WHERE id=? AND session_id=? AND version=?",
    args: [body.cartId, owner.id, body.expectedVersion],
  });
  if (updated.rowsAffected !== 1) {
    await conflict(tx, owner, "VERSION_CONFLICT", "Tu pedido cambió. Revisa los valores guardados.");
  }
}
