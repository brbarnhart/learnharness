/**
 * Study-view layout. Pins containment and arrow separation, not pixel constants.
 * The basal-ganglia fixture's modules are sibling roots; nesting is a
 * hand-built atlas. The fixture is not loaded by the app.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { foldAtlas, type AtlasLedgers, type FoldedAtlas } from "../src/core/atlas.ts";
import type { AtlasModule, AtlasPathway, AtlasPopulation, AtlasProjection } from "../src/core/contracts.ts";
import { layoutAtlas, UNPLACED_MODULE_ID, type AtlasModuleBox, type AtlasPopulationBox } from "../src/core/atlas-layout.ts";

const AT = "2026-10-24T00:00:00.000Z";
const PROVENANCE = [{ chatId: "c", messageId: "m" }];

function module(id: string, name: string, parentId: string | null): AtlasModule {
	return { id, name, parentId, purpose: `${name} purpose.`, createdAt: AT, updatedAt: AT, provenance: PROVENANCE };
}

function population(id: string, name: string, moduleId: string): AtlasPopulation {
	return { id, name, moduleId, createdAt: AT, updatedAt: AT, provenance: PROVENANCE };
}

function projection(
	id: string,
	fromId: string,
	toId: string,
	sign: AtlasProjection["sign"],
	feedback = false,
): AtlasProjection {
	return { id, name: id, fromId, toId, sign, feedback, createdAt: AT, updatedAt: AT, provenance: PROVENANCE };
}

function atlas(parts: Partial<FoldedAtlas> & Pick<FoldedAtlas, "modules">): FoldedAtlas {
	return {
		modules: parts.modules,
		populations: parts.populations ?? [],
		projections: parts.projections ?? [],
		pathways: parts.pathways ?? [],
	};
}

function strictlyInside(outer: AtlasModuleBox, inner: { x: number; y: number; width: number; height: number }): boolean {
	return (
		inner.x > outer.x &&
		inner.y > outer.y &&
		inner.x + inner.width < outer.x + outer.width &&
		inner.y + inner.height < outer.y + outer.height
	);
}

function centerInside(outer: AtlasModuleBox, inner: AtlasPopulationBox): boolean {
	const cx = inner.x + inner.width / 2;
	const cy = inner.y + inner.height / 2;
	return cx > outer.x && cx < outer.x + outer.width && cy > outer.y && cy < outer.y + outer.height;
}

describe("layoutAtlas", () => {
	it("lays out an empty atlas with no modules", () => {
		const layout = layoutAtlas(atlas({ modules: [] }));
		assert.equal(layout.modules.length, 0);
		assert.equal(layout.populations.length, 0);
		assert.equal(layout.projections.length, 0);
	});

	it("nests a child module and its population inside the parent", () => {
		const layout = layoutAtlas(
			atlas({
				modules: [module("mod_parent", "Parent", null), module("mod_child", "Child", "mod_parent"), module("mod_child_b", "Child B", "mod_parent")],
				populations: [population("pop_in", "Inside", "mod_child")],
			}),
		);
		const parent = layout.modules.find((box) => box.id === "mod_parent");
		const child = layout.modules.find((box) => box.id === "mod_child");
		const childB = layout.modules.find((box) => box.id === "mod_child_b");
		const pop = layout.populations.find((box) => box.id === "pop_in");
		assert.ok(parent && child && childB && pop);
		assert.ok(strictlyInside(parent, child));
		assert.ok(strictlyInside(parent, childB));
		assert.ok(centerInside(child, pop));
		assert.ok(centerInside(parent, pop));
		assert.ok(child.y < childB.y, "sibling modules keep atlas order");
	});

	it("places a population whose module is missing in a frame that is not a module", () => {
		const layout = layoutAtlas(
			atlas({
				modules: [module("mod_parent", "Parent", null)],
				populations: [population("pop_lost", "Lost", "mod_missing")],
			}),
		);
		const frame = layout.modules.find((box) => box.id === UNPLACED_MODULE_ID);
		const pop = layout.populations.find((box) => box.id === "pop_lost");
		assert.ok(frame && pop);
		assert.equal(frame.kind, "unplaced");
		assert.ok(centerInside(frame, pop));
		assert.equal(layout.modules.some((box) => box.kind === "module" && box.id === "mod_missing"), false);
	});

	it("treats a parent cycle as roots and still nests a child of a cycle member", () => {
		const layout = layoutAtlas(
			atlas({
				modules: [
					module("mod_a", "A", "mod_b"),
					module("mod_b", "B", "mod_c"),
					module("mod_c", "C", "mod_b"),
				],
			}),
		);
		const a = layout.modules.find((box) => box.id === "mod_a");
		const b = layout.modules.find((box) => box.id === "mod_b");
		const c = layout.modules.find((box) => box.id === "mod_c");
		assert.ok(a && b && c);
		assert.ok(strictlyInside(b, a));
		assert.equal(strictlyInside(b, c), false);
		assert.equal(strictlyInside(c, b), false);
	});

	it("offsets reciprocal arrows and flags feedback on the basal-ganglia fixture", () => {
		const ledgers = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", "atlas-ledgers.json"), "utf8")) as AtlasLedgers;
		const folded = foldAtlas(ledgers);
		const layout = layoutAtlas(folded);
		const bg = layout.modules.find((box) => box.id === "mod_bg");
		const thal = layout.modules.find((box) => box.id === "mod_thal");
		assert.ok(bg && thal);
		assert.ok(bg.y < thal.y, "root modules stack in atlas order");
		for (const id of ["pop_dsn", "pop_gpi", "pop_gpe", "pop_stn"]) {
			const pop = layout.populations.find((box) => box.id === id);
			assert.ok(pop);
			assert.ok(centerInside(bg, pop), id);
		}
		const thalPop = layout.populations.find((box) => box.id === "pop_thal");
		assert.ok(thalPop);
		assert.ok(centerInside(thal, thalPop));
		const xs = ["pop_dsn", "pop_gpi", "pop_gpe", "pop_stn"].map((id) => layout.populations.find((box) => box.id === id)!.x);
		const ys = ["pop_dsn", "pop_gpi", "pop_gpe", "pop_stn"].map((id) => layout.populations.find((box) => box.id === id)!.y);
		assert.deepEqual(xs, [...xs].sort((p, q) => p - q));
		assert.ok(xs[0]! < xs[1]! && xs[1]! < xs[2]! && xs[2]! < xs[3]!);
		assert.equal(new Set(ys).size, 1);

		const forward = layout.projections.find((arrow) => arrow.id === "prj_gpe_stn");
		const back = layout.projections.find((arrow) => arrow.id === "prj_stn_gpe");
		assert.ok(forward && back);
		assert.equal(forward.feedback, false);
		assert.equal(back.feedback, true);
		const apart = Math.hypot(forward.labelX - back.labelX, forward.labelY - back.labelY);
		assert.ok(apart > 1, `reciprocal arrows share a midpoint (${apart})`);
	});

	it("keeps a pathway's broken step out of the geometry", () => {
		const broken: AtlasPathway = {
			id: "pwy_gone",
			name: "missing step",
			projectionIds: ["prj_missing"],
			brokenAt: 1,
			createdAt: AT,
			updatedAt: AT,
			provenance: PROVENANCE,
		};
		const layout = layoutAtlas(atlas({ modules: [module("mod_parent", "Parent", null)], pathways: [broken] }));
		assert.equal(layout.projections.length, 0);
		assert.equal(layout.modules.length, 1);
	});
});
