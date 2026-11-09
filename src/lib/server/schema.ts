import "server-only";
import { runTransaction } from "./transactions";

// These are the eight explicitly requested fictional examples, not business facts.
const examples = [
  ["pastor", "Tacos", "Pastor", 2400],
  ["asada", "Tacos", "Asada", 3000],
  ["pollo", "Tacos", "Pollo", 2600],
  ["carnitas", "Tacos", "Carnitas", 2800],
  ["champinones", "Tacos", "Champiñones", 2500],
  ["nopales", "Tacos", "Nopales", 2300],
  ["agua-jamaica", "Bebidas", "Agua de jamaica", 2500],
  ["agua-horchata", "Bebidas", "Agua de horchata", 2500],
] as const;

const ddl = [
  `CREATE TABLE IF NOT EXISTS productos (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('Tacos','Bebidas')),
    price_cents INTEGER NOT NULL CHECK (typeof(price_cents)='integer' AND price_cents>=0),
    sort_order INTEGER NOT NULL CHECK (typeof(sort_order)='integer' AND sort_order>=0),
    illustration_url TEXT NOT NULL,
    visual_version TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sesiones (
    id TEXT PRIMARY KEY NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    current_cart_id TEXT REFERENCES carritos(id),
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS carritos (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL REFERENCES sesiones(id),
    status TEXT NOT NULL CHECK (status IN ('editable','confirmed')),
    version INTEGER NOT NULL DEFAULT 0 CHECK (typeof(version)='integer' AND version>=0),
    order_id TEXT UNIQUE REFERENCES pedidos(id),
    created_at TEXT NOT NULL,
    CHECK ((status='editable' AND order_id IS NULL) OR
           (status='confirmed' AND order_id IS NOT NULL))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS un_carrito_editable
     ON carritos(session_id) WHERE status='editable'`,
  `CREATE TABLE IF NOT EXISTS carrito_lineas (
    cart_id TEXT NOT NULL REFERENCES carritos(id),
    product_id TEXT NOT NULL REFERENCES productos(id),
    quantity INTEGER NOT NULL CHECK (typeof(quantity)='integer' AND quantity BETWEEN 1 AND 20),
    PRIMARY KEY (cart_id,product_id)
  )`,
  `CREATE TABLE IF NOT EXISTS pedidos (
    id TEXT PRIMARY KEY NOT NULL,
    cart_id TEXT NOT NULL UNIQUE REFERENCES carritos(id),
    session_id TEXT NOT NULL REFERENCES sesiones(id),
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status='confirmed'),
    created_at TEXT NOT NULL,
    total_cents INTEGER NOT NULL CHECK (typeof(total_cents)='integer' AND total_cents>=0),
    units INTEGER NOT NULL CHECK (typeof(units)='integer' AND units>0)
  )`,
  `CREATE INDEX IF NOT EXISTS pedidos_propietario ON pedidos(session_id,created_at)`,
  `CREATE TABLE IF NOT EXISTS pedido_lineas (
    order_id TEXT NOT NULL REFERENCES pedidos(id),
    product_id TEXT NOT NULL REFERENCES productos(id),
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('Tacos','Bebidas')),
    sort_order INTEGER NOT NULL CHECK (typeof(sort_order)='integer' AND sort_order>=0),
    unit_price_cents INTEGER NOT NULL CHECK (typeof(unit_price_cents)='integer' AND unit_price_cents>=0),
    quantity INTEGER NOT NULL CHECK (typeof(quantity)='integer' AND quantity BETWEEN 1 AND 20),
    subtotal_cents INTEGER NOT NULL CHECK (typeof(subtotal_cents)='integer' AND subtotal_cents=unit_price_cents*quantity),
    illustration_url TEXT NOT NULL,
    visual_version TEXT NOT NULL,
    PRIMARY KEY (order_id,product_id)
  )`,
  `CREATE TABLE IF NOT EXISTS operaciones_idempotentes (
    session_id TEXT NOT NULL REFERENCES sesiones(id),
    idempotency_key TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    response_status INTEGER NOT NULL CHECK (response_status=200),
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (session_id,idempotency_key)
  )`,
  `CREATE TABLE IF NOT EXISTS marcador_semilla (
    id TEXT PRIMARY KEY NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TRIGGER IF NOT EXISTS pedidos_inmutables_update BEFORE UPDATE ON pedidos
     BEGIN SELECT RAISE(ABORT,'Immutable order'); END`,
  `CREATE TRIGGER IF NOT EXISTS pedidos_inmutables_delete BEFORE DELETE ON pedidos
     BEGIN SELECT RAISE(ABORT,'Immutable order'); END`,
  `CREATE TRIGGER IF NOT EXISTS pedido_lineas_inmutables_update BEFORE UPDATE ON pedido_lineas
     BEGIN SELECT RAISE(ABORT,'Immutable order line'); END`,
  `CREATE TRIGGER IF NOT EXISTS pedido_lineas_inmutables_delete BEFORE DELETE ON pedido_lineas
     BEGIN SELECT RAISE(ABORT,'Immutable order line'); END`,
];

let readiness: Promise<void> | undefined;

export function ensureSchema(): Promise<void> {
  if (!readiness) {
    readiness = initialize().catch((error: unknown) => {
      readiness = undefined;
      throw error;
    });
  }
  return readiness;
}

async function initialize() {
  // libSQL enables foreign keys by default. Fail closed if that invariant changes.
  await runTransaction("write", async (tx) => {
    const fk = await tx.execute("PRAGMA foreign_keys");
    if (Number(fk.rows[0]?.foreign_keys) !== 1) {
      throw new Error("Foreign keys must be enabled");
    }
    for (const sql of ddl) await tx.execute(sql);
    // The marker is read only after the write lock, including across processes.
    const marker = await tx.execute({
      sql: "SELECT id FROM marcador_semilla WHERE id=?",
      args: ["taqueria-monterey-menu-v1"],
    });
    if (marker.rows.length === 0) {
      for (const [sortOrder, [id, category, name, price]] of examples.entries()) {
        await tx.execute({
          sql: `INSERT INTO productos
            (id,name,category,price_cents,sort_order,illustration_url,visual_version)
            VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
          args: [id, name, category, price, sortOrder, `/illustrations/v1/${id}.svg`, "v1"],
        });
      }
      await tx.execute({
        sql: "INSERT INTO marcador_semilla (id,created_at) VALUES (?,?)",
        args: ["taqueria-monterey-menu-v1", new Date().toISOString()],
      });
    }
  });
}
