import { sessionPOST } from "@/lib/server/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = sessionPOST;
export { methodNotAllowed as OPTIONS } from "@/lib/server/routes";
