/**
 * Circuit teach sessions: the circuit fragment stays off the numeric
 * loader, and the atlas tool is registered only when an AtlasStore is
 * handed in (the handler does that for domain "circuit").
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFauxCore } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { composeInstructions, createProberAgent, createTeacherAgent } from "../src/agent/teacher-agent.ts";
import { createProberTools, createTeacherTools, type ProberToolContext, type TeacherToolContext } from "../src/agent/tools.ts";
import type { PiEngine } from "../src/agent/models.ts";
import type { AtlasLedgers } from "../src/core/contracts.ts";
import type { AtlasStore, ChatStore, JobStore } from "../src/core/ports.ts";
import { formatAtlasList, foldAtlas } from "../src/core/atlas.ts";

const PHRASE = "List the atlas before you add a record.";

function fauxEngine(): PiEngine {
	const faux = createFauxCore({});
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

function memoryAtlas(): AtlasStore {
	const ledgers: AtlasLedgers = { modules: [], populations: [], projections: [], pathways: [] };
	return {
		appendModule(line) {
			ledgers.modules.push(line);
		},
		appendPopulation(line) {
			ledgers.populations.push(line);
		},
		appendProjection(line) {
			ledgers.projections.push(line);
		},
		appendPathway(line) {
			ledgers.pathways.push(line);
		},
		readLedgers() {
			return {
				modules: ledgers.modules.slice(),
				populations: ledgers.populations.slice(),
				projections: ledgers.projections.slice(),
				pathways: ledgers.pathways.slice(),
			};
		},
	};
}

const chatStore = { getChat: () => null } as unknown as ChatStore;
const jobStore = {} as JobStore;

function teacherCtx(atlasStore?: AtlasStore): TeacherToolContext {
	return {
		chatId: "chat_circuit",
		chatStore,
		jobStore,
		spawn: () => {},
		...(atlasStore ? { atlasStore } : {}),
	};
}

function proberCtx(atlasStore?: AtlasStore): ProberToolContext {
	return {
		chatId: "chat_circuit",
		chatStore,
		deliver: () => {},
		jobStore,
		spawn: () => {},
		...(atlasStore ? { atlasStore } : {}),
	};
}

async function shown(tool: AgentTool<any>, input: unknown, toolCallId = "call_1"): Promise<{ text: string; details: { ok: boolean; id?: string; error?: string } }> {
	const result = await tool.execute!(toolCallId, input);
	const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
	return { text, details: result.details as { ok: boolean; id?: string; error?: string } };
}

describe("circuit prompt", () => {
	it("a general teacher prompt does not include the circuit fragment", () => {
		const base = composeInstructions("teacher");
		assert.equal(base.includes(PHRASE), false);
		assert.equal(composeInstructions("teacher", undefined, { circuit: false }), base);
		assert.equal(composeInstructions("teacher", {}), base);
		assert.equal(composeInstructions("prober").includes(PHRASE), false);
		assert.equal(composeInstructions("practice").includes(PHRASE), false);
	});

	it("circuit compose appends the fragment for the teacher only", () => {
		const base = composeInstructions("teacher");
		const circuit = composeInstructions("teacher", undefined, { circuit: true });
		assert.ok(circuit.startsWith(base));
		assert.match(circuit, /List the atlas before you add a record\./);
		assert.equal(composeInstructions("prober", undefined, { circuit: true }).includes(PHRASE), false);
		assert.equal(composeInstructions("practice", undefined, { circuit: true }).includes(PHRASE), false);
		const withSwitches = composeInstructions("teacher", {}, { circuit: true });
		assert.match(withSwitches, /List the atlas before you add a record\./);
		assert.match(withSwitches, /## Learner files/);
	});

	it("agent construction appends the fragment only on a circuit teacher", () => {
		const engine = fauxEngine();
		const circuit = createTeacherAgent(undefined, { engine, promptSwitches: {}, circuit: true });
		assert.match(circuit.state.systemPrompt, /List the atlas before you add a record\./);
		const general = createTeacherAgent(undefined, { engine, promptSwitches: {} });
		assert.equal(general.state.systemPrompt.includes(PHRASE), false);
		const cached = createTeacherAgent(undefined, { engine });
		assert.equal(cached.state.systemPrompt.includes(PHRASE), false);
		const prober = createProberAgent(proberCtx(), { engine, promptSwitches: {}, circuit: true });
		assert.equal(prober.state.systemPrompt.includes(PHRASE), false);
	});
});

describe("atlas tool registration", () => {
	it("a general session has no atlas tool", () => {
		assert.equal("atlas" in createTeacherTools(teacherCtx()), false);
		assert.equal("atlas_list" in createProberTools(proberCtx()), false);
	});

	it("a circuit session gives the teacher atlas and the prober a read-only list", () => {
		const store = memoryAtlas();
		const teacher = Object.keys(createTeacherTools(teacherCtx(store))).sort();
		assert.ok(teacher.includes("atlas"));
		assert.equal(teacher.includes("atlas_list"), false);
		const prober = Object.keys(createProberTools(proberCtx(store))).sort();
		assert.ok(prober.includes("atlas_list"));
		assert.equal(prober.includes("atlas"), false);
		// No settings switch drops the circuit tool.
		assert.ok(createTeacherTools(teacherCtx(store), { atlas: false }).atlas);
		assert.ok(createProberTools(proberCtx(store), { atlas_list: false }).atlas_list);
	});
});

describe("atlas tool writes", () => {
	it("adds a module, lists it, rejects a cycle, and keeps the prose reminder", async () => {
		const store = memoryAtlas();
		const tools = createTeacherTools(teacherCtx(store));
		const added = await shown(tools.atlas!, { action: "add_module", name: "Outer", purpose: "The outer module." });
		assert.equal(added.details.ok, true);
		assert.match(added.details.id ?? "", /^mod_[a-f0-9]{12}$/);
		assert.match(added.text, new RegExp(`Added module Outer \\(${added.details.id}\\)`));
		assert.match(added.text, /State this fact in the lesson prose this same turn/);
		const outerId = added.details.id!;

		const inner = await shown(tools.atlas!, {
			action: "add_module",
			name: "Inner",
			purpose: "The inner module.",
			parentId: outerId,
		});
		assert.equal(inner.details.ok, true);

		const listed = await shown(tools.atlas!, { action: "list" });
		assert.equal(listed.text, formatAtlasList(foldAtlas(store.readLedgers())));
		assert.match(listed.text, /Outer/);
		assert.match(listed.text, /Inner/);

		const cycle = await shown(tools.atlas!, {
			action: "update",
			id: outerId,
			name: "Outer",
			purpose: "The outer module.",
			parentId: inner.details.id,
		});
		assert.equal(cycle.details.ok, false);
		assert.match(cycle.details.error ?? "", /cycle/);
		assert.match(formatAtlasList(foldAtlas(store.readLedgers())), new RegExp(`Inner \\(${inner.details.id}\\) parent ${outerId}`));
	});

	it("rejects a pathway that is not one contiguous chain", async () => {
		const store = memoryAtlas();
		const tools = createTeacherTools(teacherCtx(store));
		const module = await shown(tools.atlas!, { action: "add_module", name: "Loop", purpose: "A loop." });
		const a = await shown(tools.atlas!, { action: "add_population", name: "A", moduleId: module.details.id });
		const b = await shown(tools.atlas!, { action: "add_population", name: "B", moduleId: module.details.id });
		const c = await shown(tools.atlas!, { action: "add_population", name: "C", moduleId: module.details.id });
		const ab = await shown(tools.atlas!, {
			action: "add_projection",
			name: "A to B",
			fromId: a.details.id,
			toId: b.details.id,
			sign: "excitatory",
		});
		const ac = await shown(tools.atlas!, {
			action: "add_projection",
			name: "A to C",
			fromId: a.details.id,
			toId: c.details.id,
			sign: "inhibitory",
		});
		const pathway = await shown(tools.atlas!, {
			action: "add_pathway",
			name: "Not a chain",
			projectionIds: [ab.details.id, ac.details.id],
		});
		assert.equal(pathway.details.ok, false);
		assert.match(pathway.details.error ?? "", /contiguous/);
	});

	it("refuses an id on add, and the prober list sees a teacher write", async () => {
		const store = memoryAtlas();
		const teacher = createTeacherTools(teacherCtx(store));
		const refused = await shown(teacher.atlas!, { action: "add_module", id: "mod_mine", name: "Nope", purpose: "Nope." });
		assert.equal(refused.details.ok, false);
		assert.match(refused.details.error ?? "", /Omit id/);
		await shown(teacher.atlas!, { action: "add_module", name: "Seen", purpose: "Visible to the probe." });
		const prober = createProberTools(proberCtx(store));
		const listed = await shown(prober.atlas_list!, {});
		assert.match(listed.text, /Seen/);
		assert.equal(listed.text, formatAtlasList(foldAtlas(store.readLedgers())));
	});
});
