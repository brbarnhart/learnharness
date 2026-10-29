/**
 * Atlas ledger adapter and GET /api/atlas. Backs up any real data/atlas
 * files for the duration of the file and restores them after.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import { after, describe, it } from "node:test";
import { GET } from "../app/api/atlas/route.ts";
import { ATLAS_FILES, ATLAS_FORMAT_FILE, PATHS } from "../config.ts";
import { prepareAtlasWrite, type AtlasWrite } from "../src/core/atlas.ts";
import { readAtlas } from "../src/server/atlas.ts";
import { atlasStore } from "../src/store/atlas.ts";
import type { FoldedAtlas } from "../src/core/contracts.ts";

const FILES = [...Object.values(ATLAS_FILES), ATLAS_FORMAT_FILE];
const backups: Array<{ file: string; bak: string }> = [];
for (const file of FILES) {
	if (fs.existsSync(file)) {
		const bak = `${file}.atlastest.bak`;
		fs.renameSync(file, bak);
		backups.push({ file, bak });
	}
}

after(() => {
	for (const file of FILES) fs.rmSync(file, { force: true });
	for (const { file, bak } of backups) fs.renameSync(bak, file);
	if (backups.length === 0) fs.rmSync(PATHS.atlas, { recursive: true, force: true });
});

const BY = { chatId: "chat_store", messageId: "m1" };
const BY2 = { chatId: "chat_store", messageId: "m2" };
const AT = "2026-10-24T00:00:00.000Z";
const AT2 = "2026-10-24T01:00:00.000Z";

function append(atlas: FoldedAtlas, write: AtlasWrite): void {
	const result = prepareAtlasWrite(atlas, write);
	if (!result.ok) throw new Error(result.error);
	const { ledger, line } = result.append;
	if (ledger === "modules") atlasStore.appendModule(line);
	else if (ledger === "populations") atlasStore.appendPopulation(line);
	else if (ledger === "projections") atlasStore.appendProjection(line);
	else atlasStore.appendPathway(line);
}

describe("atlas store", () => {
	it("folds corrections, skips a corrupt line, and GET returns that fold", async () => {
		assert.equal(fs.existsSync(ATLAS_FORMAT_FILE), false);
		append(readAtlas(), { op: "add_module", id: "mod_bg", name: "Basal ganglia", parentId: null, purpose: "Selects actions.", at: AT, by: BY });
		assert.equal(JSON.parse(fs.readFileSync(ATLAS_FORMAT_FILE, "utf8")).version, 1);
		fs.appendFileSync(ATLAS_FILES.modules, "{not json\n", "utf-8");
		append(readAtlas(), { op: "update_module", id: "mod_bg", name: "Basal ganglia nuclei", parentId: null, purpose: "Selects actions.", at: AT2, by: BY2 });
		append(readAtlas(), { op: "retire", id: "mod_bg", at: AT2, by: BY2 });
		append(readAtlas(), { op: "add_module", id: "mod_thal", name: "Thalamus", parentId: null, purpose: "Relays output.", at: AT2, by: BY2 });

		const folded = readAtlas();
		assert.deepEqual(folded.modules.map((module) => module.id), ["mod_thal"]);
		const response = await GET();
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), folded);

		fs.writeFileSync(ATLAS_FORMAT_FILE, `${JSON.stringify({ version: 99 })}\n`, "utf-8");
		assert.throws(() => atlasStore.readLedgers(), /format version 99/);
	});
});
