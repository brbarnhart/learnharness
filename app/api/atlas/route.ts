import { readAtlas } from "@/src/server";

/**
 * The circuit atlas. Thin transport over the folded ledgers. Writes are
 * teacher tool calls, not this route.
 */

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(readAtlas());
}
