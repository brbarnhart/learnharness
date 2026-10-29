/**
 * Circuit-atlas tools. The teacher writes; the prober only lists.
 *
 * Registered only when the session domain is circuit (the handler passes
 * an AtlasStore). Ids are minted here. The model does not invent them.
 * Validation failures return as the tool text so the model can retry.
 * A write reminds the teacher to state the fact in lesson prose: the
 * extractor never reads the atlas.
 */

import { Type, type Static } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import type { FoldedAtlas } from "../../core/contracts.ts";
import type { AtlasStore } from "../../core/ports.ts";
import type { AtlasAppend, AtlasWrite } from "../../core/atlas.ts";
import { foldAtlas, formatAtlasList, mintAtlasId, prepareAtlasWrite } from "../../core/atlas.ts";

export interface AtlasToolContext {
	chatId: string;
	atlasStore: AtlasStore;
}

const PROSE_REMINDER =
	"State this fact in the lesson prose this same turn. The extractor reads the lesson, not the atlas.";

const atlasInput = Type.Object({
	action: Type.Union(
		[
			Type.Literal("list"),
			Type.Literal("add_module"),
			Type.Literal("add_population"),
			Type.Literal("add_projection"),
			Type.Literal("add_pathway"),
			Type.Literal("update"),
			Type.Literal("retire"),
		],
		{
			description:
				"list returns the atlas. add_* allocates a new id. update replaces one existing record. retire drops one id.",
		},
	),
	id: Type.Optional(
		Type.String({
			description: "Existing atlas id. Required for update and retire. Omit on add — the server mints the id.",
		}),
	),
	name: Type.Optional(Type.String({ description: "Record name. Required on add and update." })),
	parentId: Type.Optional(
		Type.Union([Type.String(), Type.Null()], {
			description: "Parent module id, or null for a root. Required on a module update. Omitted on add_module means a root.",
		}),
	),
	purpose: Type.Optional(Type.String({ description: "One sentence: what this module is for. Required on a module add or update." })),
	moduleId: Type.Optional(Type.String({ description: "The population's module id. Required on a population add or update." })),
	note: Type.Optional(
		Type.String({
			description: "Optional short note. On update, omit it to clear a note you no longer want.",
		}),
	),
	fromId: Type.Optional(Type.String({ description: "Projection source population id. Required on a projection add or update." })),
	toId: Type.Optional(Type.String({ description: "Projection target population id. Required on a projection add or update. Must differ from fromId." })),
	sign: Type.Optional(
		Type.Union([Type.Literal("excitatory"), Type.Literal("inhibitory"), Type.Literal("modulatory")], {
			description: "Projection sign. Required on a projection add or update.",
		}),
	),
	feedback: Type.Optional(
		Type.Boolean({
			description: "True when this projection is a return arc you are marking. On update, omit it to clear the mark. Not a cycle detector.",
		}),
	),
	projectionIds: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Pathway steps, in order. Each projection's target must be the next projection's source. Required on a pathway add or update. Send the full list on update.",
		}),
	),
});

type AtlasInput = Static<typeof atlasInput>;

function toolResult(text: string, details: { ok: true; id?: string } | { ok: false; error: string }) {
	return { text, details };
}

function fail(error: string) {
	return toolResult(error, { ok: false, error });
}

function requireText(value: string | undefined, label: string): string | null {
	if (typeof value !== "string" || value.trim().length === 0) return `${label} is required.`;
	return null;
}

function readFolded(store: AtlasStore): FoldedAtlas | string {
	try {
		return foldAtlas(store.readLedgers());
	} catch (err) {
		return err instanceof Error ? err.message : "The atlas could not be read.";
	}
}

function liveKind(atlas: FoldedAtlas, id: string): "module" | "population" | "projection" | "pathway" | null {
	if (atlas.modules.some((module) => module.id === id)) return "module";
	if (atlas.populations.some((population) => population.id === id)) return "population";
	if (atlas.projections.some((projection) => projection.id === id)) return "projection";
	if (atlas.pathways.some((pathway) => pathway.id === id)) return "pathway";
	return null;
}

function buildWrite(atlas: FoldedAtlas, input: AtlasInput, at: string, by: { chatId: string; messageId: string }): AtlasWrite | string {
	if (input.action.startsWith("add_") && input.id !== undefined && input.id.trim().length > 0) {
		return "Add allocates a new id. Omit id. List the atlas and update if you meant an existing record.";
	}
	if ((input.action === "update" || input.action === "retire") && (input.id === undefined || input.id.trim().length === 0)) {
		return `${input.action} needs the atlas id from list.`;
	}

	if (input.action === "retire") {
		return { op: "retire", id: input.id!.trim(), at, by };
	}

	if (input.action === "add_module" || (input.action === "update" && liveKind(atlas, input.id!.trim()) === "module")) {
		const nameError = requireText(input.name, "name");
		const purposeError = requireText(input.purpose, "purpose");
		if (input.action === "update" && input.parentId === undefined) {
			return ["A module update needs parentId (a module id, or null for a root).", nameError, purposeError].filter(Boolean).join("\n");
		}
		if (nameError || purposeError) return [nameError, purposeError].filter(Boolean).join("\n");
		const parentId = input.parentId === undefined ? null : input.parentId;
		if (parentId !== null && parentId.trim().length === 0) return "parentId must be a module id, or null for a root.";
		const id = input.action === "add_module" ? mintAtlasId("mod") : input.id!.trim();
		return { op: input.action === "add_module" ? "add_module" : "update_module", id, name: input.name!, parentId, purpose: input.purpose!, at, by };
	}

	if (input.action === "add_population" || (input.action === "update" && liveKind(atlas, input.id!.trim()) === "population")) {
		const nameError = requireText(input.name, "name");
		const moduleError = requireText(input.moduleId, "moduleId");
		if (nameError || moduleError) return [nameError, moduleError].filter(Boolean).join("\n");
		const id = input.action === "add_population" ? mintAtlasId("pop") : input.id!.trim();
		const note = input.note;
		return {
			op: input.action === "add_population" ? "add_population" : "update_population",
			id,
			name: input.name!,
			moduleId: input.moduleId!,
			...(note !== undefined ? { note } : {}),
			at,
			by,
		};
	}

	if (input.action === "add_projection" || (input.action === "update" && liveKind(atlas, input.id!.trim()) === "projection")) {
		const problems = [
			requireText(input.name, "name"),
			requireText(input.fromId, "fromId"),
			requireText(input.toId, "toId"),
			input.sign === undefined ? "sign is required (excitatory, inhibitory, or modulatory)." : null,
		].filter((problem): problem is string => problem !== null);
		if (problems.length > 0) return problems.join("\n");
		const id = input.action === "add_projection" ? mintAtlasId("prj") : input.id!.trim();
		return {
			op: input.action === "add_projection" ? "add_projection" : "update_projection",
			id,
			name: input.name!,
			fromId: input.fromId!,
			toId: input.toId!,
			sign: input.sign!,
			feedback: input.feedback ?? false,
			...(input.note !== undefined ? { note: input.note } : {}),
			at,
			by,
		};
	}

	if (input.action === "add_pathway" || (input.action === "update" && liveKind(atlas, input.id!.trim()) === "pathway")) {
		const problems = [
			requireText(input.name, "name"),
			!input.projectionIds || input.projectionIds.length === 0 ? "projectionIds is required." : null,
		].filter((problem): problem is string => problem !== null);
		if (problems.length > 0) return problems.join("\n");
		const id = input.action === "add_pathway" ? mintAtlasId("pwy") : input.id!.trim();
		return {
			op: input.action === "add_pathway" ? "add_pathway" : "update_pathway",
			id,
			name: input.name!,
			projectionIds: input.projectionIds!,
			...(input.note !== undefined ? { note: input.note } : {}),
			at,
			by,
		};
	}

	if (input.action === "update") return `Unknown atlas id ${input.id!.trim()}.`;
	return "Unknown atlas action.";
}

function successText(write: AtlasWrite): string {
	if (write.op === "retire") return `Retired ${write.id}.\n${PROSE_REMINDER}`;
	const kind = write.op.endsWith("module")
		? "module"
		: write.op.endsWith("population")
			? "population"
			: write.op.endsWith("projection")
				? "projection"
				: "pathway";
	const verb = write.op.startsWith("add_") ? "Added" : "Updated";
	return `${verb} ${kind} ${write.name} (${write.id}).\n${PROSE_REMINDER}`;
}

function commit(store: AtlasStore, append: AtlasAppend): void {
	if (append.ledger === "modules") store.appendModule(append.line);
	else if (append.ledger === "populations") store.appendPopulation(append.line);
	else if (append.ledger === "projections") store.appendProjection(append.line);
	else store.appendPathway(append.line);
}

/** The teacher's write tool. One tool, seven actions. */
export function atlasWriteTools(ctx: AtlasToolContext): Record<string, AgentTool<any>> {
	const tool: AgentTool<typeof atlasInput> = {
		name: "atlas",
		label: "atlas",
		description:
			"Read and write the circuit atlas for this lesson. " +
			"list first: ids, names, parents, signs, pathway length, broken pathways. Reuse an id to extend a record; add allocates a new id (do not send one). " +
			"update replaces the mutable fields of one record — send every field you want kept; omitting note or feedback clears it. retire drops a mistake. " +
			"A pathway is one contiguous chain of projections. feedback marks a return arc; it is not a cycle check. " +
			"After every add, update, or retire, state that fact in the lesson prose in the same turn. The extractor reads the lesson, not the atlas.",
		parameters: atlasInput,
		execute: serverExecute("atlas", atlasInput, async (input, exec) => {
			const atlas = readFolded(ctx.atlasStore);
			if (typeof atlas === "string") return fail(atlas);
			if (input.action === "list") return toolResult(formatAtlasList(atlas), { ok: true });
			const write = buildWrite(atlas, input, new Date().toISOString(), { chatId: ctx.chatId, messageId: exec.toolCallId });
			if (typeof write === "string") return fail(write);
			const prepared = prepareAtlasWrite(atlas, write);
			if (!prepared.ok) return fail(prepared.error);
			try {
				commit(ctx.atlasStore, prepared.append);
			} catch (err) {
				return fail(err instanceof Error ? err.message : "The atlas write failed.");
			}
			return toolResult(successText(write), { ok: true, id: write.id });
		}),
	};
	return { atlas: tool };
}

const atlasListInput = Type.Object({});

/** The prober's read-only atlas list. Separate from list_sessions / list_propositions. */
export function atlasListTools(ctx: AtlasToolContext): Record<string, AgentTool<any>> {
	const tool: AgentTool<typeof atlasListInput> = {
		name: "atlas_list",
		label: "atlas_list",
		description:
			"Read the circuit atlas: modules, populations, signed projections, and named pathways, with ids. " +
			"Read-only. Use it while probing so circuitry already in the atlas can shape the edge you bracket. " +
			"This is not the proposition graph. list_sessions and list_propositions stay the proposition map.",
		parameters: atlasListInput,
		execute: serverExecute("atlas_list", atlasListInput, async () => {
			const atlas = readFolded(ctx.atlasStore);
			if (typeof atlas === "string") return fail(atlas);
			return toolResult(formatAtlasList(atlas), { ok: true });
		}),
	};
	return { atlas_list: tool };
}
