/**
 * Atlas practice: the marker names records without their steps, the
 * problem tool commits the atlas readout, and POST /api/chats writes
 * that marker from server-side names.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-atlas-practice-"));
process.env.LH_DATA_DIR = TMP;

const { ATLAS_FILES } = await import("../config.ts");
const { foldAtlas, formatLesion, formatPathway, atlasPracticeKey, resolveAtlasPicks } = await import("../src/core/atlas.ts");
const {
	atlasContextPicks,
	hasAtlasContext,
	nativeInputCause,
	newAtlasContextMessage,
	toLlmMessages,
} = await import("../src/core/native-messages.ts");
const { projectView } = await import("../src/core/view.ts");
const { sessionMarkdown } = await import("../src/core/session-markdown.ts");
const { composeInstructions, createPracticeAgent, createTeacherAgent } = await import("../src/agent/teacher-agent.ts");
const { createPracticeGate, practiceTools, problemTool } = await import("../src/agent/tools/practice.ts");
const { POST } = await import("../app/api/chats/route.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { createFauxCore } = await import("@earendil-works/pi-ai");
import type { AtlasLedgers, FoldedAtlas } from "../src/core/atlas.ts";
import type { AtlasContextPick, LhMessage } from "../src/core/native-messages.ts";
import type { PiEngine } from "../src/agent/models.ts";

const PHRASE = "Set atlasDemand and omit modelSolution.";
const ledgers = JSON.parse(
	fs.readFileSync(path.join(import.meta.dirname, "fixtures", "atlas-ledgers.json"), "utf8"),
) as AtlasLedgers;
const atlas: FoldedAtlas = foldAtlas(ledgers);

for (const [name, rows] of [
	["modules", ledgers.modules],
	["populations", ledgers.populations],
	["projections", ledgers.projections],
	["pathways", ledgers.pathways],
] as const) {
	const file = ATLAS_FILES[name];
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

const PICKS: AtlasContextPick[] = [
	{ id: "pwy_direct", name: "direct pathway", role: "redraw" },
	{ id: "pop_gpi", name: "GPi", role: "lesion" },
];

function fauxEngine(): PiEngine {
	const faux = createFauxCore({});
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

function atlasCtx(folded: FoldedAtlas = atlas, picks: readonly AtlasContextPick[] = PICKS) {
	return { read: () => folded, picks: () => picks };
}

describe("atlas-context marker", () => {
	it("names practice picks and does not carry the pathway readout", () => {
		const marker = newAtlasContextMessage(PICKS);
		const key = formatPathway(atlas, "pwy_direct");
		assert.ok(key);
		assert.equal(marker.customType, "atlas-context");
		assert.match(marker.content, /\[Session context\] — picked from the circuit atlas/);
		assert.ok(marker.content.includes("- [pwy_direct] direct pathway (redraw)"));
		assert.ok(marker.content.includes("- [pop_gpi] GPi (lesion)"));
		assert.equal(marker.content.includes(key), false);
		assert.equal(marker.content.includes("—inhibitory→"), false);
		assert.equal(JSON.stringify(marker.details).includes("—inhibitory→"), false);
		assert.deepEqual(marker.details, { picks: PICKS });
		assert.equal(hasAtlasContext([marker]), true);
		assert.deepEqual(atlasContextPicks([marker]), PICKS);
	});

	it("a circuit lesson names the module and tells the teacher to list the rest", () => {
		const marker = newAtlasContextMessage([{ id: "mod_bg", name: "Basal ganglia", role: "module" }]);
		assert.match(marker.content, /opens on one atlas module/);
		assert.ok(marker.content.includes("- [mod_bg] Basal ganglia"));
		assert.ok(marker.content.includes("List the atlas for the rest of the circuit."));
		assert.equal(marker.content.includes("atlasDemand"), false);
		assert.equal(marker.content.includes(PHRASE), false);
	});

	it("flattens to a user message and projects a data part", () => {
		const marker = newAtlasContextMessage(PICKS);
		const wire = toLlmMessages([marker as unknown as LhMessage] as never);
		assert.equal(wire[0]!.role, "user");
		assert.equal(nativeInputCause(marker as never, []), "neutral");
		const view = projectView([marker as unknown as LhMessage] as never);
		const part = view[0]!.parts[0] as { type: string; data: unknown };
		assert.equal(part.type, "data-atlas-context");
		assert.deepEqual(part.data, marker.details);
	});
});

describe("atlas answer key", () => {
	it("a redraw key is the pathway readout, including a broken pathway", () => {
		const key = atlasPracticeKey(atlas, PICKS, { type: "redraw", pathwayId: "pwy_direct" });
		if (!key.ok) throw new Error(key.error);
		assert.equal(key.key, formatPathway(atlas, "pwy_direct"));
		const brokenAtlas: FoldedAtlas = {
			...atlas,
			pathways: atlas.pathways.map((pathway) => (pathway.id === "pwy_direct" ? { ...pathway, brokenAt: 1 } : pathway)),
		};
		const broken = atlasPracticeKey(brokenAtlas, PICKS, { type: "redraw", pathwayId: "pwy_direct" });
		if (!broken.ok) throw new Error(broken.error);
		assert.equal(broken.key, "direct pathway (pwy_direct) is broken at step 1");
	});

	it("a lesion key is the lesion query, and a crossed role is rejected", () => {
		const key = atlasPracticeKey(atlas, PICKS, { type: "lesion", populationId: "pop_gpi" });
		if (!key.ok) throw new Error(key.error);
		assert.equal(key.key, formatLesion(atlas, "pop_gpi"));
		const crossed = atlasPracticeKey(atlas, PICKS, { type: "lesion", populationId: "pwy_direct" });
		assert.equal(crossed.ok, false);
		const modulePick = atlasPracticeKey(atlas, [{ id: "mod_bg", role: "module" }], { type: "redraw", pathwayId: "mod_bg" });
		assert.equal(modulePick.ok, false);
	});

	it("resolveAtlasPicks uses atlas names, drops unknowns, and caps at 16", () => {
		const picks = resolveAtlasPicks(atlas, { pathwayIds: ["pwy_loop", "nope"], populationIds: ["pop_gpi"] }, "practice");
		assert.deepEqual(picks, [
			{ id: "pwy_loop", name: "STN-GPe loop", role: "redraw" },
			{ id: "pop_gpi", name: "GPi", role: "lesion" },
		]);
		const many = resolveAtlasPicks(
			atlas,
			{ pathwayIds: [], populationIds: Array.from({ length: 20 }, () => "pop_gpi") },
			"practice",
		);
		assert.equal(many.length, 1);
		const capped = resolveAtlasPicks(
			{
				...atlas,
				populations: Array.from({ length: 20 }, (_, i) => ({
					...atlas.populations[0]!,
					id: `pop_${i}`,
					name: `P${i}`,
				})),
			},
			{ populationIds: Array.from({ length: 20 }, (_, i) => `pop_${i}`) },
			"practice",
		);
		assert.equal(capped.length, 16);
		assert.equal(capped[15]!.id, "pop_15");
		const taught = resolveAtlasPicks(atlas, { moduleId: "mod_bg" }, "teach");
		assert.deepEqual(taught, [{ id: "mod_bg", name: "Basal ganglia", role: "module" }]);
		assert.deepEqual(resolveAtlasPicks(atlas, { moduleId: "mod_missing" }, "teach"), []);
	});
});

describe("problem atlasDemand", () => {
	it("writes the server key onto the original arguments and ignores a model solution", () => {
		const args = {
			statement: "Redraw the direct pathway.",
			mode: "recall",
			atlasDemand: { type: "redraw", pathwayId: "pwy_direct" },
			modelSolution: "the model invented this",
		};
		const tool = problemTool(createPracticeGate({ chatId: "c", chatStore: { getChat: () => null } }), () => [], atlasCtx());
		const returned = tool.prepareArguments!(args) as { modelSolution: string };
		const key = formatPathway(atlas, "pwy_direct")!;
		assert.equal(args.modelSolution, key);
		assert.equal(returned.modelSolution, key);
		assert.notEqual(returned, args);
	});

	it("the wrapped registry keeps that key on the caller's object", () => {
		const args = {
			statement: "What does this lesion disconnect?",
			mode: "recall",
			atlasDemand: { type: "lesion", populationId: "pop_gpi" },
			modelSolution: "symptoms",
		};
		const tools = practiceTools({
			chatId: "c",
			chatStore: { getChat: () => ({ messages: [] }) },
			graphNodes: () => [],
			atlas: atlasCtx(),
		});
		tools.problem!.prepareArguments!(args);
		assert.equal(args.modelSolution, formatLesion(atlas, "pop_gpi"));
	});

	it("the tool result carries the key, and a bad demand does not arm the gate", async () => {
		const gate = createPracticeGate({ chatId: "c", chatStore: { getChat: () => null } });
		const tool = problemTool(gate, undefined, atlasCtx());
		const posed = await tool.execute("call_ok", {
			statement: "Redraw the direct pathway.",
			mode: "recall",
			atlasDemand: { type: "redraw", pathwayId: "pwy_direct" },
			modelSolution: "invented",
		} as never);
		assert.equal(posed.isError, undefined);
		const text = (posed.content[0] as { text: string }).text;
		assert.match(text, /^Problem posed — the turn ends here/);
		assert.ok(text.includes(formatPathway(atlas, "pwy_direct")!));
		assert.equal(text.includes("invented"), false);
		assert.equal(posed.details, null);
		assert.equal(gate.problemActive, true);

		const idle = createPracticeGate({ chatId: "c", chatStore: { getChat: () => null } });
		const rejected = await problemTool(idle, undefined, atlasCtx()).execute("call_bad", {
			statement: "Redraw it.",
			mode: "recall",
			atlasDemand: { type: "redraw", pathwayId: "pop_gpi" },
		} as never);
		assert.equal(rejected.isError, true);
		assert.match((rejected.details as { problems: string[] }).problems[0]!, /not a redraw pick/);
		assert.equal(idle.problemActive, false);
	});

	it("home-graph practice still requires modelSolution and rejects atlasDemand", async () => {
		const gate = createPracticeGate({ chatId: "c", chatStore: { getChat: () => null } });
		const tool = problemTool(gate);
		const missing = await tool.execute("call_missing", { statement: "S", mode: "recall" } as never);
		assert.equal(missing.isError, true);
		assert.match((missing.details as { problems: string[] }).problems[0]!, /modelSolution is required/);
		assert.equal(gate.problemActive, false);
		const demand = await tool.execute("call_demand", {
			statement: "S",
			mode: "recall",
			modelSolution: "M",
			atlasDemand: { type: "redraw", pathwayId: "pwy_direct" },
		} as never);
		assert.equal(demand.isError, true);
		assert.match((demand.details as { problems: string[] }).problems[0]!, /circuit atlas/);
		const home = await tool.execute("call_home", { statement: "S", mode: "recall", modelSolution: "M" } as never);
		assert.equal(home.isError, undefined);
		assert.equal((home.content[0] as { text: string }).text.includes("Committed answer key"), false);
	});
});

describe("atlas practice prompt", () => {
	it("appends only for a practice session flagged as atlas", () => {
		const base = composeInstructions("practice");
		assert.equal(base.includes(PHRASE), false);
		assert.equal(composeInstructions("practice", undefined, { atlas: false }), base);
		assert.equal(composeInstructions("teacher").includes(PHRASE), false);
		assert.equal(composeInstructions("teacher", undefined, { atlas: true }).includes(PHRASE), false);
		assert.equal(composeInstructions("prober", undefined, { atlas: true }).includes(PHRASE), false);
		assert.equal(composeInstructions("practice", undefined, { circuit: true }).includes(PHRASE), false);
		const atlasPrompt = composeInstructions("practice", undefined, { atlas: true });
		assert.ok(atlasPrompt.startsWith(base));
		assert.ok(atlasPrompt.includes(PHRASE));
		assert.equal(atlasPrompt.includes("List the atlas before you add a record."), false);
		const engine = fauxEngine();
		const session = createPracticeAgent({ chatId: "c", chatStore: { getChat: () => null } }, { engine, atlas: true });
		assert.match(session.state.systemPrompt, /Set atlasDemand and omit modelSolution\./);
		const cached = createPracticeAgent({ chatId: "c", chatStore: { getChat: () => null } }, { engine });
		assert.equal(cached.state.systemPrompt.includes(PHRASE), false);
		const teacher = createTeacherAgent(undefined, { engine, atlas: true });
		assert.equal(teacher.state.systemPrompt.includes(PHRASE), false);
	});
});

describe("markdown hides the marker and the pose key", () => {
	it("the marker is invisible, the pose shows the statement, and conclude reveals the key", () => {
		const key = formatPathway(atlas, "pwy_direct")!;
		const marker = newAtlasContextMessage(PICKS);
		const messages = [
			marker,
			{
				id: "a1",
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "call-p1",
						name: "problem",
						arguments: { statement: "Redraw the direct pathway.", mode: "recall", modelSolution: key },
					},
				],
			},
			{
				id: "r1",
				role: "toolResult",
				toolCallId: "call-p1",
				toolName: "problem",
				content: [{ type: "text", text: `Problem posed\n\nCommitted answer key:\n${key}` }],
				details: null,
				isError: false,
			},
			{
				id: "a2",
				role: "assistant",
				content: [{ type: "toolCall", id: "call-c1", name: "conclude", arguments: { outcome: "solved", verdict: "The chain was complete." } }],
			},
			{
				id: "r2",
				role: "toolResult",
				toolCallId: "call-c1",
				toolName: "conclude",
				content: [{ type: "text", text: "concluded" }],
				details: null,
				isError: false,
			},
		] as unknown as LhMessage[];
		const md = sessionMarkdown(messages, { anchors: false });
		assert.equal(md.includes("[Session context]"), false);
		assert.equal(md.includes("(redraw)"), false);
		const problemAt = md.indexOf("### Problem");
		const concludedAt = md.indexOf("### Concluded");
		assert.ok(problemAt >= 0 && concludedAt > problemAt);
		const pose = md.slice(problemAt, concludedAt);
		assert.ok(pose.includes("Redraw the direct pathway."));
		assert.equal(pose.includes("prj_direct"), false);
		assert.ok(md.slice(concludedAt).includes("prj_direct"));
	});
});

describe("POST /api/chats atlas context", () => {
	async function post(body: unknown) {
		const res = await POST(new Request("http://test/api/chats", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}));
		assert.equal(res.status, 200);
		const { id } = (await res.json()) as { id: string };
		return chatStore.getChat(id)!;
	}

	it("practice picks become a names-only marker and drop proposition picks", async () => {
		const record = await post({
			title: "drill",
			kind: "practice",
			atlasContext: { pathwayIds: ["pwy_direct"], populationIds: ["pop_gpi"], name: "smuggled steps —inhibitory→" },
			graphContext: { propositions: [{ id: "n", name: "N", statement: "A statement that must not land." }] },
		});
		assert.equal(record.kind, "practice");
		assert.equal(record.domain, undefined);
		assert.equal(record.messages.length, 1);
		const marker = record.messages[0] as { customType: string; content: string; details: { picks: AtlasContextPick[] } };
		assert.equal(marker.customType, "atlas-context");
		assert.deepEqual(marker.details.picks, PICKS);
		assert.equal(marker.content.includes("A statement that must not land."), false);
		assert.equal(marker.content.includes("—inhibitory→"), false);
	});

	it("a circuit lesson's marker uses the atlas module name", async () => {
		const record = await post({
			title: "Basal ganglia",
			domain: "circuit",
			atlasContext: { moduleId: "mod_bg" },
		});
		assert.equal(record.domain, "circuit");
		assert.equal(record.kind, undefined);
		const marker = record.messages[0] as { customType: string; content: string; details: { picks: AtlasContextPick[] } };
		assert.equal(marker.customType, "atlas-context");
		assert.deepEqual(marker.details.picks, [{ id: "mod_bg", name: "Basal ganglia", role: "module" }]);
		assert.ok(marker.content.includes("- [mod_bg] Basal ganglia"));
		assert.equal(marker.content.includes("prj_direct"), false);
	});

	it("unknown atlas ids do not fall through to a graph marker", async () => {
		const record = await post({
			title: "drill",
			kind: "practice",
			atlasContext: { pathwayIds: ["pwy_missing"] },
			graphContext: { propositions: [{ id: "n", name: "N", statement: "Should stay off this chat." }] },
		});
		assert.equal(record.messages.length, 0);
	});

	it("a home-graph practice session still stores proposition picks", async () => {
		const record = await post({
			title: "logic",
			kind: "practice",
			graphContext: { propositions: [{ id: "n_a", name: "Modus ponens", statement: "If P then Q." }] },
		});
		const marker = record.messages[0] as { customType: string; content: string };
		assert.equal(marker.customType, "graph-context");
		assert.ok(marker.content.includes("If P then Q."));
	});
});
