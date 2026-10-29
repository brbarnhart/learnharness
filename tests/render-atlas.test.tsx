/**
 * The atlas study view's markup. AtlasStudy is presentational (no router).
 * Teach's create contract is startAtlasTeach: a circuit chat seeded by module id.
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AtlasStudy, nextPracticeIds, startAtlasPractice, startAtlasTeach } from "../components/atlas-view.tsx";
import { foldAtlas, formatLesion, type AtlasLedgers, type FoldedAtlas } from "../src/core/atlas.ts";

const AT = "2026-10-24T00:00:00.000Z";

function fixtureAtlas(): FoldedAtlas {
	const ledgers = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", "atlas-ledgers.json"), "utf8")) as AtlasLedgers;
	const folded = foldAtlas(ledgers);
	return {
		...folded,
		pathways: [
			...folded.pathways,
			{
				id: "pwy_gone",
				name: "missing step",
				projectionIds: ["prj_missing"],
				brokenAt: 1,
				createdAt: AT,
				updatedAt: AT,
				provenance: [{ chatId: "c", messageId: "m" }],
			},
		],
	};
}

function study(atlas: FoldedAtlas, selected: { moduleId?: string | null; populationId?: string | null; pathwayId?: string | null } = {}) {
	return renderToStaticMarkup(
		<AtlasStudy
			atlas={atlas}
			selectedModuleId={selected.moduleId ?? null}
			selectedPopulationId={selected.populationId ?? null}
			selectedPathwayId={selected.pathwayId ?? null}
			onSelectModule={() => {}}
			onSelectPopulation={() => {}}
			onSelectPathway={() => {}}
			onTeach={() => {}}
			teachBusy={false}
			teachError={null}
			practiceIds={[]}
			onTogglePractice={() => {}}
			onClearPractice={() => {}}
			onPractice={() => {}}
			practiceBusy={false}
			practiceError={null}
		/>,
	);
}

function tagWith(html: string, testid: string): string {
	const needle = `data-testid="${testid}"`;
	const at = html.indexOf(needle);
	assert.ok(at > 0, testid);
	const start = html.lastIndexOf("<", at);
	const end = html.indexOf(">", at);
	return html.slice(start, end + 1);
}

/** The disabled attribute. Class names such as `disabled:opacity-50` do not count. */
function hasDisabledAttr(tag: string): boolean {
	return /(?:^|\s)disabled(?:[\s>=]|$)/.test(tag);
}

describe("AtlasStudy", () => {
	it("explains an empty atlas and does not wear a session title", () => {
		const empty: FoldedAtlas = { modules: [], populations: [], projections: [], pathways: [] };
		const html = study(empty);
		assert.ok(html.includes('data-testid="atlas-empty"'));
		assert.ok(html.includes("Circuit lessons fill the atlas. Nothing is here yet."));
		assert.equal(html.includes('data-testid="atlas-canvas"'), false);
		assert.equal(html.includes("font-title"), false);
		assert.equal(hasDisabledAttr(tagWith(html, "atlas-teach")), true);
	});

	it("labels signs, dashes feedback, dims outside a pathway, and matches the lesion readout", () => {
		const atlas = fixtureAtlas();
		const html = study(atlas, { populationId: "pop_gpi", pathwayId: "pwy_loop", moduleId: "mod_bg" });
		assert.ok(html.includes(">inhibitory<"));
		assert.ok(html.includes(">excitatory<"));
		assert.equal(html.includes("font-title"), false);

		const feedback = html.match(/data-projection-id="prj_stn_gpe"[\s\S]*?<line\b[^>]*>/);
		assert.ok(feedback, "feedback projection line");
		assert.ok(feedback[0].includes('data-feedback="true"'));
		assert.match(feedback[0], /stroke-dasharray="6 4"|strokeDasharray="6 4"/);

		const direct = html.match(/data-projection-id="prj_direct"[\s\S]*?(?=<g |<\/svg>)/);
		assert.ok(direct);
		assert.ok(direct[0].includes('data-dimmed="true"'));
		const loop = html.match(/data-projection-id="prj_gpe_stn"[\s\S]*?(?=<g |<\/svg>)/);
		assert.ok(loop);
		assert.ok(loop[0].includes('data-dimmed="false"'));

		const card = html.match(/data-testid="lesion-card"[^>]*>([\s\S]*?)<\/pre>/);
		assert.equal(card?.[1], formatLesion(atlas, "pop_gpi"));
		assert.ok(html.includes("broken at step 1"));
		assert.equal(hasDisabledAttr(tagWith(html, "atlas-teach")), false);
		assert.ok(html.includes("Basal ganglia"));
		assert.ok(html.includes("Action selection through opposing pathways."));
	});
});

describe("startAtlasTeach", () => {
	it("posts a circuit teach chat and returns its href", async () => {
		const calls: { url: string; method: string; body: unknown }[] = [];
		const fetchLike = (async (url: string, init?: RequestInit) => {
			calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
			return new Response(JSON.stringify({ id: "c_new" }), { status: 200 });
		}) as typeof fetch;
		const result = await startAtlasTeach({ id: "mod_bg", name: "Basal ganglia" }, fetchLike);
		assert.equal(calls.length, 1);
		assert.equal(calls[0]!.url, "/api/chats");
		assert.equal(calls[0]!.method, "POST");
		assert.deepEqual(calls[0]!.body, { title: "Basal ganglia", domain: "circuit", atlasContext: { moduleId: "mod_bg" } });
		assert.deepEqual(result, { ok: true, href: "/chat/c_new" });
	});

	it("reports a failed create without a href", async () => {
		const fetchLike = (async () => new Response("no", { status: 500 })) as typeof fetch;
		const result = await startAtlasTeach({ id: "mod_bg", name: "Basal ganglia" }, fetchLike);
		assert.deepEqual(result, { ok: false, error: "The circuit lesson could not be started." });
	});

	it("reports a body with no id", async () => {
		const fetchLike = (async () => new Response(JSON.stringify({}), { status: 200 })) as typeof fetch;
		const result = await startAtlasTeach({ id: "mod_bg", name: "Basal ganglia" }, fetchLike);
		assert.deepEqual(result, { ok: false, error: "The circuit lesson could not be started." });
	});
});

describe("atlas practice selection", () => {
	it("the cap refuses a 17th id and a re-click removes one", () => {
		let ids: readonly string[] = [];
		for (let i = 0; i < 17; i++) ids = nextPracticeIds(ids, `pop_${i}`);
		assert.equal(ids.length, 16);
		assert.equal(ids.includes("pop_16"), false);
		const removed = nextPracticeIds(ids, "pop_0");
		assert.equal(removed.includes("pop_0"), false);
		assert.equal(removed.length, 15);
		assert.equal(nextPracticeIds(removed, "pop_16").at(-1), "pop_16");
	});

	it("posts pathway and population ids and no proposition picks", async () => {
		const calls: { body: unknown }[] = [];
		const fetchLike = (async (_url: string, init?: RequestInit) => {
			calls.push({ body: init?.body ? JSON.parse(String(init.body)) : null });
			return new Response(JSON.stringify({ id: "c_prac" }), { status: 200 });
		}) as typeof fetch;
		const result = await startAtlasPractice("direct pathway, GPi", ["pwy_direct"], ["pop_gpi"], fetchLike);
		assert.deepEqual(result, { ok: true, href: "/chat/c_prac" });
		assert.deepEqual(calls[0]!.body, {
			title: "direct pathway, GPi",
			kind: "practice",
			atlasContext: { pathwayIds: ["pwy_direct"], populationIds: ["pop_gpi"] },
		});
	});

	it("a practice pick does not replace the pathway highlight", () => {
		const atlas = fixtureAtlas();
		const html = renderToStaticMarkup(
			<AtlasStudy
				atlas={atlas}
				selectedModuleId={null}
				selectedPopulationId={null}
				selectedPathwayId="pwy_loop"
				onSelectModule={() => {}}
				onSelectPopulation={() => {}}
				onSelectPathway={() => {}}
				onTeach={() => {}}
				teachBusy={false}
				teachError={null}
				practiceIds={["pwy_direct", "pop_gpi"]}
				onTogglePractice={() => {}}
				onClearPractice={() => {}}
				onPractice={() => {}}
				practiceBusy={false}
				practiceError={null}
			/>,
		);
		assert.ok(html.includes('data-testid="atlas-practice-count"'));
		assert.ok(html.includes("2 selected"));
		assert.ok(html.includes('data-testid="atlas-practice-clear"'));
		const loop = tagWith(html, "atlas-pathway");
		assert.match(html, /data-pathway-id="pwy_loop"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-pathway-id="pwy_loop"/);
		assert.equal(loop.includes("pwy_loop") || html.includes('data-pathway-id="pwy_loop"'), true);
		assert.equal(hasDisabledAttr(tagWith(html, "atlas-practice")), false);
	});
});
