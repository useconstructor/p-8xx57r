import "server-only";
import { createClient, type Client } from "@libsql/client";

let client: Client | undefined;

// Defer configuration to a request so an unavailable runtime produces a
// recoverable API error, rather than an import-time application failure.
export const db: Client = new Proxy({} as Client, {
  get(_target, property) {
    if (!client) {
      const url = process.env.TURSO_DATABASE_URL;
      const authToken = process.env.TURSO_AUTH_TOKEN;
      if (!url || !authToken) throw new Error("Database configuration unavailable");
      client = createClient({ url, authToken });
    }
    const value = Reflect.get(client, property);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
