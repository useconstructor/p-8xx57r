import "server-only";
import type { Transaction } from "@libsql/client";
import { db } from "@/lib/db";

function isBusy(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return ["SQLITE_BUSY", "SQLITE_BUSY_SNAPSHOT", "SQLITE_LOCKED"].includes(String(error.code));
}

export async function runTransaction<T>(
  mode: "read" | "write",
  action: (tx: Transaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let tx: Transaction | undefined;
    let commitStarted = false;
    let rolledBack = true;
    try {
      tx = await db.transaction(mode);
      const result = await action(tx);
      commitStarted = true;
      await tx.commit();
      return result;
    } catch (error) {
      if (tx && !tx.closed) {
        try {
          await tx.rollback();
        } catch {
          rolledBack = false;
        }
      }
      // Only retry a definite lock rejection whose uncommitted work has
      // rolled back. A lost commit response is never interpreted as failure.
      if (commitStarted || !rolledBack || !isBusy(error) || attempt >= 7) throw error;
    } finally {
      tx?.close();
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(50 * 2 ** attempt, 800)));
  }
}
