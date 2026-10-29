/**
 * Circuit atlas — fold, write checks, lesion, pathway readout.
 *
 * Pure. No IO, no node builtins. Ledgers stay append-only; this module
 * derives the live atlas and refuses a write that would break the
 * invariants in docs/atlas.md. A pathway that later cites a retired
 * projection folds as broken. The fold does not rewrite it.
 */

import type {
	AtlasLedgers,
	AtlasModule,
	AtlasModuleLine,
	AtlasModuleRecord,
	AtlasPathway,
	AtlasPathwayLine,
	AtlasPathwayRecord,
	AtlasPopulation,
	AtlasPopulationLine,
	AtlasPopulationRecord,
	AtlasProjection,
	AtlasProjectionLine,
	AtlasProjectionRecord,
	AtlasProvenancePoint,
	AtlasSign,
	AtlasTombstone,
	FoldedAtlas,
} from "./contracts.ts";

export type { AtlasLedgers, FoldedAtlas };

const ID_RE = /^(mod|pop|prj|pwy)_[a-z0-9_]+$/;
const SIGNS: readonly AtlasSign[] = ["excitatory", "inhibitory", "modulatory"];

export type AtlasLedgerName = "modules" | "populations" | "projections" | "pathways";

export type AtlasAppend =
	| { ledger: "modules"; line: AtlasModuleLine }
	| { ledger: "populations"; line: AtlasPopulationLine }
	| { ledger: "projections"; line: AtlasProjectionLine }
	| { ledger: "pathways"; line: AtlasPathwayLine };

/** One authoring operation. `at` is the line's timestamp. `by` is the tool call. */
export type AtlasWrite =
	| { op: "add_module"; id: string; name: string; parentId: string | null; purpose: string; at: string; by: AtlasProvenancePoint }
	| { op: "add_population"; id: string; name: string; moduleId: string; note?: string; at: string; by: AtlasProvenancePoint }
	| { op: "add_projection"; id: string; name: string; fromId: string; toId: string; sign: AtlasSign; feedback?: boolean; note?: string; at: string; by: AtlasProvenancePoint }
	| { op: "add_pathway"; id: string; name: string; projectionIds: string[]; note?: string; at: string; by: AtlasProvenancePoint }
	| { op: "update_module"; id: string; name: string; parentId: string | null; purpose: string; at: string; by: AtlasProvenancePoint }
	| { op: "update_population"; id: string; name: string; moduleId: string; note?: string; at: string; by: AtlasProvenancePoint }
	| { op: "update_projection"; id: string; name: string; fromId: string; toId: string; sign: AtlasSign; feedback?: boolean; note?: string; at: string; by: AtlasProvenancePoint }
	| { op: "update_pathway"; id: string; name: string; projectionIds: string[]; note?: string; at: string; by: AtlasProvenancePoint }
	| { op: "retire"; id: string; at: string; by: AtlasProvenancePoint };

export type AtlasWriteResult = { ok: true; append: AtlasAppend } | { ok: false; error: string };

/** 12 hex chars, matching the graph id mint (`n_` / `arg_`). Browser-safe. */
export function mintAtlasId(prefix: "mod" | "pop" | "prj" | "pwy"): string {
	const bytes = new Uint8Array(6);
	crypto.getRandomValues(bytes);
	const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
	return `${prefix}_${hex}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isProvenance(v: unknown): v is AtlasProvenancePoint {
	return isRecord(v) && typeof v.chatId === "string" && v.chatId.length > 0 && typeof v.messageId === "string" && v.messageId.length > 0;
}

function readProvenance(v: unknown): AtlasProvenancePoint[] | null {
	if (!Array.isArray(v) || v.length === 0) return null;
	const out: AtlasProvenancePoint[] = [];
	for (const item of v) {
		if (!isProvenance(item)) return null;
		out.push({ chatId: item.chatId, messageId: item.messageId });
	}
	return out;
}

function readId(v: unknown, prefix: "mod" | "pop" | "prj" | "pwy"): string | null {
	if (typeof v !== "string" || !ID_RE.test(v) || !v.startsWith(`${prefix}_`)) return null;
	return v;
}

function readStamp(v: unknown): string | null {
	return typeof v === "string" && v.length > 0 ? v : null;
}

function readName(v: unknown): string | null {
	if (typeof v !== "string") return null;
	const name = v.trim();
	return name.length > 0 ? name : null;
}

function readNote(v: unknown): string | undefined | null {
	if (v === undefined) return undefined;
	if (typeof v !== "string") return null;
	const note = v.trim();
	return note.length > 0 ? note : undefined;
}

/** A tombstone, or null when the line is not one. Missing fields → null. */
function readTombstone(v: unknown, prefix: "mod" | "pop" | "prj" | "pwy"): AtlasTombstone | null {
	if (!isRecord(v) || v.retired !== true) return null;
	const id = readId(v.id, prefix);
	const updatedAt = readStamp(v.updatedAt);
	const provenance = readProvenance(v.provenance);
	if (!id || !updatedAt || !provenance) return null;
	return { id, retired: true, updatedAt, provenance };
}

function baseFields(v: Record<string, unknown>, prefix: "mod" | "pop" | "prj" | "pwy"): { id: string; name: string; createdAt: string; updatedAt: string; provenance: AtlasProvenancePoint[] } | null {
	const id = readId(v.id, prefix);
	const name = readName(v.name);
	const createdAt = readStamp(v.createdAt);
	const updatedAt = readStamp(v.updatedAt);
	const provenance = readProvenance(v.provenance);
	if (!id || !name || !createdAt || !updatedAt || !provenance) return null;
	return { id, name, createdAt, updatedAt, provenance };
}

function parseModule(v: unknown): AtlasModuleLine | null {
	const tomb = readTombstone(v, "mod");
	if (tomb) return tomb;
	if (!isRecord(v) || v.retired === true) return null;
	const base = baseFields(v, "mod");
	const purpose = readName(v.purpose);
	if (!base || !purpose) return null;
	if (v.parentId !== null && typeof v.parentId !== "string") return null;
	const parentId = v.parentId === null ? null : readId(v.parentId, "mod");
	if (v.parentId !== null && !parentId) return null;
	return { ...base, parentId, purpose };
}

function parsePopulation(v: unknown): AtlasPopulationLine | null {
	const tomb = readTombstone(v, "pop");
	if (tomb) return tomb;
	if (!isRecord(v) || v.retired === true) return null;
	const base = baseFields(v, "pop");
	const moduleId = isRecord(v) ? readId(v.moduleId, "mod") : null;
	const note = isRecord(v) ? readNote(v.note) : null;
	if (!base || !moduleId || note === null) return null;
	return note ? { ...base, moduleId, note } : { ...base, moduleId };
}

function parseProjection(v: unknown): AtlasProjectionLine | null {
	const tomb = readTombstone(v, "prj");
	if (tomb) return tomb;
	if (!isRecord(v) || v.retired === true) return null;
	const base = baseFields(v, "prj");
	const fromId = readId(v.fromId, "pop");
	const toId = readId(v.toId, "pop");
	const sign = typeof v.sign === "string" && (SIGNS as readonly string[]).includes(v.sign) ? (v.sign as AtlasSign) : null;
	const note = readNote(v.note);
	if (!base || !fromId || !toId || !sign || typeof v.feedback !== "boolean" || note === null) return null;
	if (fromId === toId) return null;
	return note ? { ...base, fromId, toId, sign, feedback: v.feedback, note } : { ...base, fromId, toId, sign, feedback: v.feedback };
}

function parsePathway(v: unknown): AtlasPathwayLine | null {
	const tomb = readTombstone(v, "pwy");
	if (tomb) return tomb;
	if (!isRecord(v) || v.retired === true) return null;
	const base = baseFields(v, "pwy");
	const note = readNote(v.note);
	if (!base || note === null || !Array.isArray(v.projectionIds) || v.projectionIds.length === 0) return null;
	const projectionIds: string[] = [];
	for (const id of v.projectionIds) {
		const parsed = readId(id, "prj");
		if (!parsed) return null;
		projectionIds.push(parsed);
	}
	return note ? { ...base, projectionIds, note } : { ...base, projectionIds };
}

function isTombstone(line: { retired?: true }): line is AtlasTombstone {
	return line.retired === true;
}

function unionProvenance(lines: readonly { provenance: AtlasProvenancePoint[] }[]): AtlasProvenancePoint[] {
	const seen = new Set<string>();
	const out: AtlasProvenancePoint[] = [];
	for (const line of lines) {
		for (const point of line.provenance) {
			const key = `${point.chatId}\u0000${point.messageId}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(point);
		}
	}
	return out;
}

function foldGroup<T extends { id: string; createdAt?: string; updatedAt: string; provenance: AtlasProvenancePoint[]; retired?: true }>(
	lines: readonly T[],
): (Omit<T, "retired"> & { createdAt: string }) | null {
	if (lines.length === 0) return null;
	const last = lines[lines.length - 1]!;
	if (isTombstone(last)) return null;
	const createdAt = lines.find((line) => typeof line.createdAt === "string")?.createdAt;
	if (!createdAt) return null;
	const { retired: _retired, ...rest } = last;
	return { ...rest, createdAt, updatedAt: last.updatedAt, provenance: unionProvenance(lines) };
}

function groupLines<T extends { id: string }>(lines: readonly T[]): T[][] {
	const order: string[] = [];
	const groups = new Map<string, T[]>();
	for (const line of lines) {
		let group = groups.get(line.id);
		if (!group) {
			group = [];
			groups.set(line.id, group);
			order.push(line.id);
		}
		group.push(line);
	}
	return order.map((id) => groups.get(id)!);
}

/** 1-based step where the chain breaks, or null when the pathway is intact. */
export function pathwayBreakAt(projectionIds: readonly string[], projections: ReadonlyMap<string, AtlasProjection>): number | null {
	let previous: AtlasProjection | null = null;
	for (let i = 0; i < projectionIds.length; i++) {
		const projection = projections.get(projectionIds[i]!);
		if (!projection) return i + 1;
		if (previous && previous.toId !== projection.fromId) return i + 1;
		previous = projection;
	}
	return null;
}

/** Derive the live atlas. Unparseable lines are skipped. Last line per id wins. */
export function foldAtlas(ledgers: AtlasLedgers): FoldedAtlas {
	const modules: AtlasModule[] = [];
	for (const group of groupLines(ledgers.modules.map(parseModule).filter((line): line is AtlasModuleLine => line !== null))) {
		const folded = foldGroup(group);
		// foldGroup already drops a tombstone. What remains is a live module.
		if (folded) modules.push(folded as AtlasModule);
	}
	const populations: AtlasPopulation[] = [];
	for (const group of groupLines(ledgers.populations.map(parsePopulation).filter((line): line is AtlasPopulationLine => line !== null))) {
		const folded = foldGroup(group);
		if (folded) populations.push(folded as AtlasPopulation);
	}
	const projections: AtlasProjection[] = [];
	for (const group of groupLines(ledgers.projections.map(parseProjection).filter((line): line is AtlasProjectionLine => line !== null))) {
		const folded = foldGroup(group);
		if (folded) projections.push(folded as AtlasProjection);
	}
	const byProjection = new Map(projections.map((projection) => [projection.id, projection]));
	const pathways: AtlasPathway[] = [];
	for (const group of groupLines(ledgers.pathways.map(parsePathway).filter((line): line is AtlasPathwayLine => line !== null))) {
		const folded = foldGroup(group);
		if (!folded) continue;
		const record = folded as AtlasPathwayRecord;
		pathways.push({ ...record, brokenAt: pathwayBreakAt(record.projectionIds, byProjection) });
	}
	return { modules, populations, projections, pathways };
}

function fail(error: string): AtlasWriteResult {
	return { ok: false, error };
}

function requireBy(by: AtlasProvenancePoint): string | null {
	if (!isProvenance(by)) return "Provenance needs a chat id and a message id.";
	return null;
}

function requireAt(at: string): string | null {
	return readStamp(at) ? null : "A timestamp is required.";
}

function liveId(atlas: FoldedAtlas, id: string): AtlasLedgerName | null {
	if (atlas.modules.some((record) => record.id === id)) return "modules";
	if (atlas.populations.some((record) => record.id === id)) return "populations";
	if (atlas.projections.some((record) => record.id === id)) return "projections";
	if (atlas.pathways.some((record) => record.id === id)) return "pathways";
	return null;
}

function moduleCycle(modules: readonly AtlasModule[], id: string, parentId: string | null): boolean {
	const parents = new Map(modules.map((module) => [module.id, module.parentId]));
	parents.set(id, parentId);
	const seen = new Set<string>();
	let current = parentId;
	while (current) {
		if (current === id || seen.has(current)) return true;
		seen.add(current);
		current = parents.get(current) ?? null;
	}
	return false;
}

function checkChain(atlas: FoldedAtlas, projectionIds: readonly string[]): string | null {
	if (projectionIds.length === 0) return "A pathway needs at least one projection.";
	const seen = new Set<string>();
	const projections = new Map(atlas.projections.map((projection) => [projection.id, projection]));
	for (let i = 0; i < projectionIds.length; i++) {
		const id = projectionIds[i]!;
		if (seen.has(id)) return `Projection ${id} is repeated in the pathway.`;
		seen.add(id);
		const projection = projections.get(id);
		if (!projection) return `Unknown projection ${id}.`;
		if (i > 0) {
			const previous = projections.get(projectionIds[i - 1]!)!;
			if (previous.toId !== projection.fromId) {
				return `Step ${i + 1} does not continue the previous projection. A pathway is one contiguous chain.`;
			}
		}
	}
	return null;
}

function moduleLine(existing: AtlasModule | undefined, write: Extract<AtlasWrite, { op: "add_module" | "update_module" }>): AtlasModuleRecord | string {
	const name = readName(write.name);
	const purpose = readName(write.purpose);
	if (!name) return "A module needs a name.";
	if (!purpose) return "A module needs a purpose.";
	if (write.parentId !== null && !write.parentId.startsWith("mod_")) return "parentId must be a module id or null.";
	// The appended line carries only the new provenance point. The fold unions.
	return {
		id: write.id,
		name,
		parentId: write.parentId,
		purpose,
		createdAt: existing?.createdAt ?? write.at,
		updatedAt: write.at,
		provenance: [write.by],
	};
}

function populationLine(existing: AtlasPopulation | undefined, write: Extract<AtlasWrite, { op: "add_population" | "update_population" }>): AtlasPopulationRecord | string {
	const name = readName(write.name);
	const note = readNote(write.note);
	if (!name) return "A population needs a name.";
	if (note === null) return "A population note must be text.";
	if (!write.moduleId.startsWith("mod_")) return "moduleId must be a module id.";
	return note
		? { id: write.id, name, moduleId: write.moduleId, note, createdAt: existing?.createdAt ?? write.at, updatedAt: write.at, provenance: [write.by] }
		: { id: write.id, name, moduleId: write.moduleId, createdAt: existing?.createdAt ?? write.at, updatedAt: write.at, provenance: [write.by] };
}

function projectionLine(existing: AtlasProjection | undefined, write: Extract<AtlasWrite, { op: "add_projection" | "update_projection" }>): AtlasProjectionRecord | string {
	const name = readName(write.name);
	const note = readNote(write.note);
	if (!name) return "A projection needs a name.";
	if (note === null) return "A projection note must be text.";
	if (!write.fromId.startsWith("pop_") || !write.toId.startsWith("pop_")) return "A projection connects two population ids.";
	if (write.fromId === write.toId) return "A projection's source and target must differ.";
	if (!(SIGNS as readonly string[]).includes(write.sign)) return "Sign must be excitatory, inhibitory, or modulatory.";
	const feedback = write.feedback ?? false;
	return note
		? { id: write.id, name, fromId: write.fromId, toId: write.toId, sign: write.sign, feedback, note, createdAt: existing?.createdAt ?? write.at, updatedAt: write.at, provenance: [write.by] }
		: { id: write.id, name, fromId: write.fromId, toId: write.toId, sign: write.sign, feedback, createdAt: existing?.createdAt ?? write.at, updatedAt: write.at, provenance: [write.by] };
}

function pathwayLine(existing: AtlasPathway | undefined, write: Extract<AtlasWrite, { op: "add_pathway" | "update_pathway" }>): AtlasPathwayRecord | string {
	const name = readName(write.name);
	const note = readNote(write.note);
	if (!name) return "A pathway needs a name.";
	if (note === null) return "A pathway note must be text.";
	if (!Array.isArray(write.projectionIds)) return "A pathway needs an ordered list of projections.";
	return note
		? { id: write.id, name, projectionIds: [...write.projectionIds], note, createdAt: existing?.createdAt ?? write.at, updatedAt: write.at, provenance: [write.by] }
		: { id: write.id, name, projectionIds: [...write.projectionIds], createdAt: existing?.createdAt ?? write.at, updatedAt: write.at, provenance: [write.by] };
}

/**
 * Check a write against the folded atlas and build the line to append.
 * Does not mutate `atlas`.
 */
export function prepareAtlasWrite(atlas: FoldedAtlas, write: AtlasWrite): AtlasWriteResult {
	const byError = requireBy(write.by);
	if (byError) return fail(byError);
	const atError = requireAt(write.at);
	if (atError) return fail(atError);
	const occupied = liveId(atlas, write.op === "retire" ? write.id : write.id);

	if (write.op === "retire") {
		const ledger = liveId(atlas, write.id);
		if (!ledger) return fail(`Unknown atlas id ${write.id}.`);
		const line: AtlasTombstone = { id: write.id, retired: true, updatedAt: write.at, provenance: [write.by] };
		return { ok: true, append: { ledger, line } as AtlasAppend };
	}

	if (write.op.startsWith("add_")) {
		if (!ID_RE.test(write.id)) return fail(`Id ${write.id} must look like mod_ / pop_ / prj_ / pwy_ plus lowercase letters, digits, or underscores.`);
		if (occupied) return fail(`Id ${write.id} is already in the atlas. List the atlas and reuse it, or mint a new id.`);
	} else if (!occupied) {
		return fail(`Unknown atlas id ${write.id}.`);
	}

	if (write.op === "add_module" || write.op === "update_module") {
		if (write.op === "add_module" && !write.id.startsWith("mod_")) return fail("A module id starts with mod_.");
		if (write.op === "update_module" && occupied !== "modules") return fail(`${write.id} is not a module.`);
		if (write.parentId !== null && !atlas.modules.some((module) => module.id === write.parentId)) return fail(`Unknown parent module ${write.parentId}.`);
		const existing = atlas.modules.find((module) => module.id === write.id);
		if (moduleCycle(atlas.modules, write.id, write.parentId)) return fail("That parent would cycle the module tree.");
		const line = moduleLine(existing, write);
		if (typeof line === "string") return fail(line);
		return { ok: true, append: { ledger: "modules", line } };
	}

	if (write.op === "add_population" || write.op === "update_population") {
		if (write.op === "add_population" && !write.id.startsWith("pop_")) return fail("A population id starts with pop_.");
		if (write.op === "update_population" && occupied !== "populations") return fail(`${write.id} is not a population.`);
		if (!atlas.modules.some((module) => module.id === write.moduleId)) return fail(`Unknown module ${write.moduleId}.`);
		const existing = atlas.populations.find((population) => population.id === write.id);
		const line = populationLine(existing, write);
		if (typeof line === "string") return fail(line);
		return { ok: true, append: { ledger: "populations", line } };
	}

	if (write.op === "add_projection" || write.op === "update_projection") {
		if (write.op === "add_projection" && !write.id.startsWith("prj_")) return fail("A projection id starts with prj_.");
		if (write.op === "update_projection" && occupied !== "projections") return fail(`${write.id} is not a projection.`);
		if (!atlas.populations.some((population) => population.id === write.fromId)) return fail(`Unknown population ${write.fromId}.`);
		if (!atlas.populations.some((population) => population.id === write.toId)) return fail(`Unknown population ${write.toId}.`);
		const existing = atlas.projections.find((projection) => projection.id === write.id);
		const line = projectionLine(existing, write);
		if (typeof line === "string") return fail(line);
		return { ok: true, append: { ledger: "projections", line } };
	}

	if (write.op === "add_pathway" || write.op === "update_pathway") {
		if (write.op === "add_pathway" && !write.id.startsWith("pwy_")) return fail("A pathway id starts with pwy_.");
		if (write.op === "update_pathway" && occupied !== "pathways") return fail(`${write.id} is not a pathway.`);
		const chainError = checkChain(atlas, write.projectionIds);
		if (chainError) return fail(chainError);
		const existing = atlas.pathways.find((pathway) => pathway.id === write.id);
		const line = pathwayLine(existing, write);
		if (typeof line === "string") return fail(line);
		return { ok: true, append: { ledger: "pathways", line } };
	}

	return fail("Unknown atlas write.");
}

function populationName(atlas: FoldedAtlas, id: string): string {
	return atlas.populations.find((population) => population.id === id)?.name ?? id;
}

function stepText(atlas: FoldedAtlas, projection: AtlasProjection): string {
	const feedback = projection.feedback ? " [feedback]" : "";
	return `${populationName(atlas, projection.fromId)} —${projection.sign}→ ${populationName(atlas, projection.toId)} (${projection.id})${feedback}`;
}

/** Learner-facing and model-facing pathway key. Broken pathways say where they break. */
export function formatPathway(atlas: FoldedAtlas, pathwayId: string): string | null {
	const pathway = atlas.pathways.find((item) => item.id === pathwayId);
	if (!pathway) return null;
	if (pathway.brokenAt !== null) return `${pathway.name} (${pathway.id}) is broken at step ${pathway.brokenAt}`;
	const projections = new Map(atlas.projections.map((projection) => [projection.id, projection]));
	const steps = pathway.projectionIds.map((id, index) => `${index + 1}. ${stepText(atlas, projections.get(id)!)}`);
	return [`${pathway.name} (${pathway.id})`, ...steps].join("\n");
}

export interface LesionReport {
	populationId: string;
	populationName: string;
	removedProjectionIds: string[];
	populationsLosingInput: string[];
	brokenPathways: { id: string; name: string; step: number }[];
}

/** Structural lesion. Null when the population is not in the atlas. */
export function lesion(atlas: FoldedAtlas, populationId: string): LesionReport | null {
	const population = atlas.populations.find((item) => item.id === populationId);
	if (!population) return null;
	const removed = atlas.projections
		.filter((projection) => projection.fromId === populationId || projection.toId === populationId)
		.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	const removedIds = new Set(removed.map((projection) => projection.id));
	const downstream = new Set<string>();
	for (const projection of removed) {
		if (projection.toId !== populationId) downstream.add(projection.toId);
	}
	const populationsLosingInput = [...downstream].sort();
	const brokenPathways = atlas.pathways
		.flatMap((pathway) => {
			const step = pathway.projectionIds.findIndex((id) => removedIds.has(id));
			return step === -1 ? [] : [{ id: pathway.id, name: pathway.name, step: step + 1 }];
		})
		.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	return {
		populationId,
		populationName: population.name,
		removedProjectionIds: removed.map((projection) => projection.id),
		populationsLosingInput,
		brokenPathways,
	};
}

/** The lesion card and the practice answer key. Null when the population is absent. */
export function formatLesion(atlas: FoldedAtlas, populationId: string): string | null {
	const report = lesion(atlas, populationId);
	if (!report) return null;
	const projections = new Map(atlas.projections.map((projection) => [projection.id, projection]));
	const removedLines = report.removedProjectionIds.length === 0
		? ["- none"]
		: report.removedProjectionIds.map((id) => `- ${stepText(atlas, projections.get(id)!)}`);
	const downstreamLines = report.populationsLosingInput.length === 0
		? ["- none"]
		: report.populationsLosingInput.map((id) => `- ${populationName(atlas, id)} (${id})`);
	const pathwayLines = report.brokenPathways.length === 0
		? ["- none"]
		: report.brokenPathways.map((pathway) => `- ${pathway.name} (${pathway.id}) at step ${pathway.step}`);
	return [
		`Lesion of ${report.populationName} (${report.populationId})`,
		"Removed projections:",
		...removedLines,
		"Populations that lose an input:",
		...downstreamLines,
		"Pathways broken:",
		...pathwayLines,
	].join("\n");
}

function moduleTreeLines(atlas: FoldedAtlas): string[] {
	const byParent = new Map<string | null, AtlasModule[]>();
	const ids = new Set(atlas.modules.map((module) => module.id));
	for (const module of atlas.modules) {
		const parent = module.parentId !== null && ids.has(module.parentId) ? module.parentId : null;
		const list = byParent.get(parent) ?? [];
		list.push(module);
		byParent.set(parent, list);
	}
	const lines: string[] = [];
	const visit = (parent: string | null, depth: number) => {
		for (const module of byParent.get(parent) ?? []) {
			const missing = module.parentId !== null && !ids.has(module.parentId) ? ` parent ${module.parentId} missing` : "";
			const parentNote = depth > 0 && module.parentId ? ` parent ${module.parentId}` : "";
			lines.push(`${"  ".repeat(depth)}- ${module.name} (${module.id})${parentNote}${missing}`);
			visit(module.id, depth + 1);
		}
	};
	visit(null, 0);
	return lines;
}

/** Identity surface for the teacher and the prober. */
export function formatAtlasList(atlas: FoldedAtlas): string {
	const modules = moduleTreeLines(atlas);
	const populations = atlas.populations.map((population) => `- ${population.name} (${population.id}) module ${population.moduleId}`);
	const projections = atlas.projections.map((projection) => {
		const feedback = projection.feedback ? " feedback" : "";
		return `- ${projection.name} (${projection.id}) ${populationName(atlas, projection.fromId)} (${projection.fromId}) —${projection.sign}→ ${populationName(atlas, projection.toId)} (${projection.toId})${feedback}`;
	});
	const pathways = atlas.pathways.map((pathway) => {
		const state = pathway.brokenAt === null ? `${pathway.projectionIds.length} steps` : `broken at step ${pathway.brokenAt}`;
		return `- ${pathway.name} (${pathway.id}) ${state}`;
	});
	const section = (title: string, lines: string[]) => [title, ...(lines.length > 0 ? lines : ["- none"])];
	return [...section("Modules:", modules), ...section("Populations:", populations), ...section("Projections:", projections), ...section("Pathways:", pathways)].join("\n");
}

/** Practice picks from one atlas session. Pathways and populations share this cap. */
export const ATLAS_PRACTICE_CAP = 16;

/** A record named on an atlas-context marker. The name is the atlas's, not the client's. */
export interface ResolvedAtlasPick {
	id: string;
	name: string;
	role: "redraw" | "lesion" | "module";
}

/**
 * Server-side pick resolution. Practice takes pathways (redraw) then
 * populations (lesion), up to the cap, and drops ids the atlas does not
 * hold. A circuit lesson takes the one module. Unknown ids are omitted
 * rather than named by the client.
 */
export function resolveAtlasPicks(
	atlas: FoldedAtlas,
	request: { pathwayIds?: readonly string[]; populationIds?: readonly string[]; moduleId?: string | null },
	audience: "practice" | "teach",
): ResolvedAtlasPick[] {
	if (audience === "teach") {
		const module = atlas.modules.find((item) => item.id === request.moduleId);
		return module ? [{ id: module.id, name: module.name, role: "module" }] : [];
	}
	const picks: ResolvedAtlasPick[] = [];
	const seen = new Set<string>();
	const add = (id: string, role: "redraw" | "lesion") => {
		if (picks.length >= ATLAS_PRACTICE_CAP || seen.has(id)) return;
		if (role === "redraw") {
			const pathway = atlas.pathways.find((item) => item.id === id);
			if (!pathway) return;
			seen.add(id);
			picks.push({ id: pathway.id, name: pathway.name, role });
			return;
		}
		const population = atlas.populations.find((item) => item.id === id);
		if (!population) return;
		seen.add(id);
		picks.push({ id: population.id, name: population.name, role });
	};
	for (const id of request.pathwayIds ?? []) add(id, "redraw");
	for (const id of request.populationIds ?? []) add(id, "lesion");
	return picks;
}

/**
 * The practice answer key. A redraw is the pathway readout. A lesion is
 * the structural lesion query. The id must be one of this session's picks
 * of that role. A missing atlas record fails. A broken pathway's key is
 * the broken-at-step readout.
 */
export function atlasPracticeKey(
	atlas: FoldedAtlas,
	picks: readonly { id: string; role: string }[],
	demand: unknown,
): { ok: true; key: string } | { ok: false; error: string } {
	if (typeof demand !== "object" || demand === null) {
		return { ok: false, error: "atlasDemand must name a redraw or a lesion." };
	}
	const type = (demand as { type?: unknown }).type;
	if (type === "redraw") {
		const id = (demand as { pathwayId?: unknown }).pathwayId;
		if (typeof id !== "string" || !picks.some((pick) => pick.id === id && pick.role === "redraw")) {
			return { ok: false, error: "pathwayId is not a redraw pick in this session." };
		}
		const key = formatPathway(atlas, id);
		if (key === null) return { ok: false, error: "That pathway is not in the atlas." };
		return { ok: true, key };
	}
	if (type === "lesion") {
		const id = (demand as { populationId?: unknown }).populationId;
		if (typeof id !== "string" || !picks.some((pick) => pick.id === id && pick.role === "lesion")) {
			return { ok: false, error: "populationId is not a lesion pick in this session." };
		}
		const key = formatLesion(atlas, id);
		if (key === null) return { ok: false, error: "That population is not in the atlas." };
		return { ok: true, key };
	}
	return { ok: false, error: "atlasDemand must name a redraw or a lesion." };
}
