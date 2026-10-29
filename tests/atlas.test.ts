/**
 * Circuit atlas fold and write checks. The fixture under tests/fixtures is
 * test data — the app never loads it.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import {
	foldAtlas,
	formatAtlasList,
	formatLesion,
	formatPathway,
	lesion,
	mintAtlasId,
	prepareAtlasWrite,
	type AtlasLedgers,
	type AtlasWrite,
	type FoldedAtlas,
} from "../src/core/atlas.ts";

const BY = { chatId: "chat_test", messageId: "m1" };
const BY2 = { chatId: "chat_test", messageId: "m2" };
const AT = "2026-10-24T00:00:00.000Z";
const AT2 = "2026-10-24T01:00:00.000Z";

function emptyLedgers(): AtlasLedgers {
	return { modules: [], populations: [], projections: [], pathways: [] };
}

function apply(ledgers: AtlasLedgers, write: AtlasWrite): FoldedAtlas {
	const result = prepareAtlasWrite(foldAtlas(ledgers), write);
	if (!result.ok) throw new Error(result.error);
	ledgers[result.append.ledger].push(result.append.line);
	return foldAtlas(ledgers);
}

function reject(ledgers: AtlasLedgers, write: AtlasWrite): string {
	const result = prepareAtlasWrite(foldAtlas(ledgers), write);
	assert.equal(result.ok, false);
	if (result.ok) throw new Error("expected rejection");
	return result.error;
}

describe("foldAtlas", () => {
	it("skips corrupt lines, keeps the first createdAt, and unions provenance on correction", () => {
		const ledgers = emptyLedgers();
		ledgers.modules.push({ nope: true }, {
			id: "mod_bg",
			name: "Basal ganglia",
			parentId: null,
			purpose: "Selects actions.",
			createdAt: AT,
			updatedAt: AT,
			provenance: [BY],
		});
		apply(ledgers, {
			op: "update_module",
			id: "mod_bg",
			name: "Basal ganglia nuclei",
			parentId: null,
			purpose: "Selects actions.",
			at: AT2,
			by: BY2,
		});
		const [module] = foldAtlas(ledgers).modules;
		assert.equal(module!.name, "Basal ganglia nuclei");
		assert.equal(module!.createdAt, AT);
		assert.equal(module!.updatedAt, AT2);
		assert.deepEqual(module!.provenance, [BY, BY2]);
	});

	it("drops a record whose last line is a tombstone", () => {
		const ledgers = emptyLedgers();
		apply(ledgers, { op: "add_module", id: "mod_bg", name: "Basal ganglia", parentId: null, purpose: "Selects actions.", at: AT, by: BY });
		apply(ledgers, { op: "retire", id: "mod_bg", at: AT2, by: BY2 });
		assert.equal(foldAtlas(ledgers).modules.length, 0);
	});

	it("restores a record when a full line follows a tombstone", () => {
		const ledgers = emptyLedgers();
		apply(ledgers, { op: "add_module", id: "mod_bg", name: "Basal ganglia", parentId: null, purpose: "Selects actions.", at: AT, by: BY });
		apply(ledgers, { op: "retire", id: "mod_bg", at: AT2, by: BY2 });
		ledgers.modules.push({
			id: "mod_bg",
			name: "Basal ganglia",
			parentId: null,
			purpose: "Selects actions again.",
			createdAt: AT2,
			updatedAt: AT2,
			provenance: [BY2],
		});
		const [module] = foldAtlas(ledgers).modules;
		assert.equal(module!.purpose, "Selects actions again.");
		assert.equal(module!.createdAt, AT);
	});
});

describe("prepareAtlasWrite", () => {
	it("rejects a module cycle, a missing parent, a self projection, and a non-chain pathway", () => {
		const ledgers = emptyLedgers();
		apply(ledgers, { op: "add_module", id: "mod_a", name: "A", parentId: null, purpose: "Top.", at: AT, by: BY });
		apply(ledgers, { op: "add_module", id: "mod_b", name: "B", parentId: "mod_a", purpose: "Nested.", at: AT, by: BY });
		assert.match(reject(ledgers, { op: "update_module", id: "mod_a", name: "A", parentId: "mod_b", purpose: "Top.", at: AT2, by: BY }), /cycle/);
		assert.match(reject(ledgers, { op: "add_module", id: "mod_c", name: "C", parentId: "mod_missing", purpose: "Nope.", at: AT, by: BY }), /Unknown parent/);

		apply(ledgers, { op: "add_population", id: "pop_a", name: "A cells", moduleId: "mod_a", at: AT, by: BY });
		apply(ledgers, { op: "add_population", id: "pop_b", name: "B cells", moduleId: "mod_b", at: AT, by: BY });
		apply(ledgers, { op: "add_population", id: "pop_c", name: "C cells", moduleId: "mod_b", at: AT, by: BY });
		assert.match(
			reject(ledgers, { op: "add_projection", id: "prj_self", name: "loop", fromId: "pop_a", toId: "pop_a", sign: "excitatory", at: AT, by: BY }),
			/must differ/,
		);
		apply(ledgers, { op: "add_projection", id: "prj_ab", name: "A to B", fromId: "pop_a", toId: "pop_b", sign: "inhibitory", at: AT, by: BY });
		apply(ledgers, { op: "add_projection", id: "prj_ca", name: "C to A", fromId: "pop_c", toId: "pop_a", sign: "excitatory", at: AT, by: BY });
		assert.match(
			reject(ledgers, { op: "add_pathway", id: "pwy_bad", name: "broken chain", projectionIds: ["prj_ab", "prj_ca"], at: AT, by: BY }),
			/contiguous/,
		);
		assert.match(
			reject(ledgers, { op: "add_pathway", id: "pwy_dup", name: "repeat", projectionIds: ["prj_ab", "prj_ab"], at: AT, by: BY }),
			/repeated/,
		);
	});

	it("retires a projection without rewriting the pathway, which then folds broken", () => {
		const ledgers = emptyLedgers();
		apply(ledgers, { op: "add_module", id: "mod_a", name: "A", parentId: null, purpose: "Top.", at: AT, by: BY });
		apply(ledgers, { op: "add_population", id: "pop_a", name: "A cells", moduleId: "mod_a", at: AT, by: BY });
		apply(ledgers, { op: "add_population", id: "pop_b", name: "B cells", moduleId: "mod_a", at: AT, by: BY });
		apply(ledgers, { op: "add_projection", id: "prj_ab", name: "A to B", fromId: "pop_a", toId: "pop_b", sign: "inhibitory", at: AT, by: BY });
		apply(ledgers, { op: "add_pathway", id: "pwy_ab", name: "A pathway", projectionIds: ["prj_ab"], at: AT, by: BY });
		const atlas = apply(ledgers, { op: "retire", id: "prj_ab", at: AT2, by: BY2 });
		assert.equal(atlas.projections.length, 0);
		assert.equal(atlas.pathways[0]!.brokenAt, 1);
		assert.equal(atlas.pathways[0]!.projectionIds[0], "prj_ab");
	});

	it("allows a projection edit that breaks an existing pathway", () => {
		const ledgers = emptyLedgers();
		apply(ledgers, { op: "add_module", id: "mod_a", name: "A", parentId: null, purpose: "Top.", at: AT, by: BY });
		apply(ledgers, { op: "add_population", id: "pop_a", name: "A cells", moduleId: "mod_a", at: AT, by: BY });
		apply(ledgers, { op: "add_population", id: "pop_b", name: "B cells", moduleId: "mod_a", at: AT, by: BY });
		apply(ledgers, { op: "add_population", id: "pop_c", name: "C cells", moduleId: "mod_a", at: AT, by: BY });
		apply(ledgers, { op: "add_projection", id: "prj_ab", name: "A to B", fromId: "pop_a", toId: "pop_b", sign: "inhibitory", at: AT, by: BY });
		apply(ledgers, { op: "add_projection", id: "prj_bc", name: "B to C", fromId: "pop_b", toId: "pop_c", sign: "excitatory", at: AT, by: BY });
		apply(ledgers, { op: "add_pathway", id: "pwy_abc", name: "chain", projectionIds: ["prj_ab", "prj_bc"], at: AT, by: BY });
		const atlas = apply(ledgers, {
			op: "update_projection",
			id: "prj_bc",
			name: "B to C",
			fromId: "pop_c",
			toId: "pop_a",
			sign: "modulatory",
			at: AT2,
			by: BY2,
		});
		assert.equal(atlas.pathways[0]!.brokenAt, 2);
	});
});

describe("lesion and readout", () => {
	it("matches the fixture's structural lesion and pathway keys", () => {
		const ledgers = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", "atlas-ledgers.json"), "utf8")) as AtlasLedgers;
		const atlas = foldAtlas(ledgers);
		assert.equal(atlas.pathways.find((pathway) => pathway.id === "pwy_direct")!.brokenAt, null);
		assert.equal(
			formatLesion(atlas, "pop_gpi"),
			[
				"Lesion of GPi (pop_gpi)",
				"Removed projections:",
				"- Direct-pathway MSNs —inhibitory→ GPi (prj_direct)",
				"- GPi —inhibitory→ Thalamus (prj_out)",
				"Populations that lose an input:",
				"- Thalamus (pop_thal)",
				"Pathways broken:",
				"- direct pathway (pwy_direct) at step 1",
			].join("\n"),
		);
		assert.deepEqual(lesion(atlas, "pop_gpi")!.removedProjectionIds, ["prj_direct", "prj_out"]);
		assert.equal(
			formatPathway(atlas, "pwy_loop"),
			[
				"STN-GPe loop (pwy_loop)",
				"1. GPe —inhibitory→ STN (prj_gpe_stn)",
				"2. STN —excitatory→ GPe (prj_stn_gpe) [feedback]",
			].join("\n"),
		);
		assert.equal(formatLesion(atlas, "pop_missing"), null);
		assert.equal(formatPathway(atlas, "pwy_missing"), null);
	});

	it("lists a lesion with no projections as empty sections", () => {
		const ledgers = emptyLedgers();
		apply(ledgers, { op: "add_module", id: "mod_a", name: "A", parentId: null, purpose: "Top.", at: AT, by: BY });
		const atlas = apply(ledgers, { op: "add_population", id: "pop_a", name: "A cells", moduleId: "mod_a", at: AT, by: BY });
		assert.match(formatLesion(atlas, "pop_a")!, /Removed projections:\n- none\nPopulations that lose an input:\n- none\nPathways broken:\n- none/);
	});
});

describe("formatAtlasList", () => {
	it("nests modules and marks a retired parent's child as missing", () => {
		const ledgers = emptyLedgers();
		apply(ledgers, { op: "add_module", id: "mod_a", name: "A", parentId: null, purpose: "Top.", at: AT, by: BY });
		apply(ledgers, { op: "add_module", id: "mod_b", name: "B", parentId: "mod_a", purpose: "Nested.", at: AT, by: BY });
		const atlas = apply(ledgers, { op: "retire", id: "mod_a", at: AT2, by: BY2 });
		const list = formatAtlasList(atlas);
		assert.match(list, /^- B \(mod_b\) parent mod_a missing$/m);
		assert.doesNotMatch(list, /mod_a\) parent/);
	});

	it("renders an empty atlas", () => {
		assert.match(formatAtlasList(foldAtlas(emptyLedgers())), /^Modules:\n- none\nPopulations:\n- none/);
	});
});

describe("mintAtlasId", () => {
	it("mints a prefixed 12-hex id", () => {
		assert.match(mintAtlasId("pop"), /^pop_[0-9a-f]{12}$/);
	});
});
