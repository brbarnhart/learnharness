/**
 * Circuit-atlas read. Writes go through the teacher tool, which appends
 * to the same store. The fold is the response body.
 */

import { foldAtlas, type FoldedAtlas } from "../core/atlas.ts";
import { atlasStore } from "../store/atlas.ts";

export function readAtlas(): FoldedAtlas {
	return foldAtlas(atlasStore.readLedgers());
}
