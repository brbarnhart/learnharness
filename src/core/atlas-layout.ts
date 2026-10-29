/**
 * Hierarchical layout for the circuit-atlas study view.
 *
 * Pure and browser-safe. Modules are nested rectangles; populations sit
 * inside their module; projections are arrows between population centers.
 * A reciprocal pair is offset so the two arrows do not share a midpoint.
 * Feedback is a flag on the arrow — the view draws it dashed.
 *
 * A population whose module is missing is still placed, inside one
 * synthetic frame. That frame is not a module and not a Teach target.
 * A parent cycle is cut by treating every module in the cycle as a root,
 * so a child of a cycle member stays nested and layout cannot recurse
 * forever. Sibling order is atlas array order.
 */

import type { AtlasModule, AtlasSign, FoldedAtlas } from "./contracts.ts";

const PAD = 16;
const HEADER = 28;
const POP_W = 168;
const POP_H = 40;
const POP_GAP = 12;
const MODULE_GAP = 20;
const ARROW_OFFSET = 10;

/** Populations whose module is missing share this frame. */
export const UNPLACED_MODULE_ID = "__unplaced__";

export interface AtlasModuleBox {
	id: string;
	kind: "module" | "unplaced";
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
	depth: number;
}

export interface AtlasPopulationBox {
	id: string;
	name: string;
	moduleId: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface AtlasProjectionArrow {
	id: string;
	fromId: string;
	toId: string;
	sign: AtlasSign;
	feedback: boolean;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	labelX: number;
	labelY: number;
}

export interface AtlasLayout {
	width: number;
	height: number;
	modules: AtlasModuleBox[];
	populations: AtlasPopulationBox[];
	projections: AtlasProjectionArrow[];
}

interface Measured {
	id: string;
	kind: "module" | "unplaced";
	name: string;
	depth: number;
	width: number;
	height: number;
	populations: { id: string; name: string; moduleId: string }[];
	children: Measured[];
}

interface Point {
	x: number;
	y: number;
}

interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

function moduleInCycle(byId: ReadonlyMap<string, AtlasModule>, id: string): boolean {
	const seen = new Set<string>();
	let current: string | null = id;
	while (current !== null) {
		if (seen.has(current)) return current === id;
		seen.add(current);
		const parentId: string | null = byId.get(current)?.parentId ?? null;
		if (parentId === null || !byId.has(parentId)) return false;
		current = parentId;
	}
	return false;
}

/** Layout parent. Null for a real root, a missing parent, or a module that sits in a parent cycle. */
function layoutParentId(byId: ReadonlyMap<string, AtlasModule>, module: AtlasModule): string | null {
	if (module.parentId === null || !byId.has(module.parentId)) return null;
	if (moduleInCycle(byId, module.id)) return null;
	return module.parentId;
}

function blockSize(populationCount: number, children: readonly Measured[]): { width: number; height: number } {
	const popRow = populationCount === 0 ? 0 : populationCount * POP_W + (populationCount - 1) * POP_GAP;
	const childWidth = children.reduce((max, child) => Math.max(max, child.width), 0);
	const width = Math.max(popRow, childWidth, POP_W) + PAD * 2;
	let height = HEADER;
	if (populationCount > 0) height += PAD + POP_H;
	if (children.length > 0) {
		height += PAD;
		height += children.reduce((sum, child) => sum + child.height, 0);
		height += MODULE_GAP * (children.length - 1);
	}
	height += PAD;
	return { width, height };
}

function measureModule(
	module: AtlasModule,
	depth: number,
	childrenOf: ReadonlyMap<string | null, AtlasModule[]>,
	popsByModule: ReadonlyMap<string, { id: string; name: string; moduleId: string }[]>,
	stack: Set<string>,
): Measured {
	// A parent cycle is already cut. This set is the backstop so a bug cannot recurse forever.
	if (stack.has(module.id)) {
		const size = blockSize(0, []);
		return { id: module.id, kind: "module", name: module.name, depth, ...size, populations: [], children: [] };
	}
	stack.add(module.id);
	const children = (childrenOf.get(module.id) ?? []).map((child) => measureModule(child, depth + 1, childrenOf, popsByModule, stack));
	stack.delete(module.id);
	const populations = popsByModule.get(module.id) ?? [];
	const size = blockSize(populations.length, children);
	return { id: module.id, kind: "module", name: module.name, depth, ...size, populations, children };
}

function place(node: Measured, x: number, y: number, modules: AtlasModuleBox[], populations: AtlasPopulationBox[]): void {
	modules.push({
		id: node.id,
		kind: node.kind,
		name: node.name,
		x,
		y,
		width: node.width,
		height: node.height,
		depth: node.depth,
	});
	let cursorY = y + HEADER;
	if (node.populations.length > 0) {
		cursorY += PAD;
		let cursorX = x + PAD;
		for (const population of node.populations) {
			populations.push({
				id: population.id,
				name: population.name,
				moduleId: population.moduleId,
				x: cursorX,
				y: cursorY,
				width: POP_W,
				height: POP_H,
			});
			cursorX += POP_W + POP_GAP;
		}
		cursorY += POP_H;
	}
	if (node.children.length > 0) {
		cursorY += PAD;
		for (const child of node.children) {
			place(child, x + PAD, cursorY, modules, populations);
			cursorY += child.height + MODULE_GAP;
		}
	}
}

function centerOf(box: Rect): Point {
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function inside(point: Point, rect: Rect): boolean {
	return point.x > rect.x && point.x < rect.x + rect.width && point.y > rect.y && point.y < rect.y + rect.height;
}

/** First boundary hit of the ray origin + t * dir, t > 0. Origin is inside the rect. */
function rectExit(origin: Point, dir: Point, rect: Rect): Point | null {
	const left = rect.x;
	const top = rect.y;
	const right = rect.x + rect.width;
	const bottom = rect.y + rect.height;
	let best = Infinity;
	const consider = (t: number, x: number, y: number) => {
		if (t > 1e-6 && t < best && x >= left - 1e-6 && x <= right + 1e-6 && y >= top - 1e-6 && y <= bottom + 1e-6) best = t;
	};
	if (dir.x !== 0) {
		const tLeft = (left - origin.x) / dir.x;
		consider(tLeft, left, origin.y + tLeft * dir.y);
		const tRight = (right - origin.x) / dir.x;
		consider(tRight, right, origin.y + tRight * dir.y);
	}
	if (dir.y !== 0) {
		const tTop = (top - origin.y) / dir.y;
		consider(tTop, origin.x + tTop * dir.x, top);
		const tBottom = (bottom - origin.y) / dir.y;
		consider(tBottom, origin.x + tBottom * dir.x, bottom);
	}
	if (!Number.isFinite(best)) return null;
	return { x: origin.x + best * dir.x, y: origin.y + best * dir.y };
}

function arrows(atlas: FoldedAtlas, populations: readonly AtlasPopulationBox[]): AtlasProjectionArrow[] {
	const byId = new Map(populations.map((population) => [population.id, population]));
	const out: AtlasProjectionArrow[] = [];
	for (const projection of atlas.projections) {
		const from = byId.get(projection.fromId);
		const to = byId.get(projection.toId);
		if (!from || !to) continue;
		const fromCenter = centerOf(from);
		const toCenter = centerOf(to);
		let dx = toCenter.x - fromCenter.x;
		let dy = toCenter.y - fromCenter.y;
		const len = Math.hypot(dx, dy);
		if (len < 1e-6) continue;
		dx /= len;
		dy /= len;
		// The reverse arc's own normal points the other way, so both arrows applying +offset separate.
		const reciprocal = atlas.projections.some(
			(other) => other.id !== projection.id && other.fromId === projection.toId && other.toId === projection.fromId,
		);
		const shift = reciprocal ? ARROW_OFFSET : 0;
		const nx = -dy;
		const ny = dx;
		let origin = { x: fromCenter.x + nx * shift, y: fromCenter.y + ny * shift };
		let target = { x: toCenter.x + nx * shift, y: toCenter.y + ny * shift };
		if (!inside(origin, from)) origin = fromCenter;
		if (!inside(target, to)) target = toCenter;
		const dir = { x: target.x - origin.x, y: target.y - origin.y };
		const start = rectExit(origin, dir, from) ?? fromCenter;
		const end = rectExit(target, { x: -dir.x, y: -dir.y }, to) ?? toCenter;
		out.push({
			id: projection.id,
			fromId: projection.fromId,
			toId: projection.toId,
			sign: projection.sign,
			feedback: projection.feedback,
			x1: start.x,
			y1: start.y,
			x2: end.x,
			y2: end.y,
			labelX: (start.x + end.x) / 2,
			labelY: (start.y + end.y) / 2,
		});
	}
	return out;
}

/** Lay the folded atlas out. An empty atlas has no boxes. */
export function layoutAtlas(atlas: FoldedAtlas): AtlasLayout {
	const byId = new Map(atlas.modules.map((module) => [module.id, module]));
	const moduleIds = new Set(byId.keys());
	const childrenOf = new Map<string | null, AtlasModule[]>();
	for (const module of atlas.modules) {
		const parentId = layoutParentId(byId, module);
		const list = childrenOf.get(parentId) ?? [];
		list.push(module);
		childrenOf.set(parentId, list);
	}
	const popsByModule = new Map<string, { id: string; name: string; moduleId: string }[]>();
	const orphans: { id: string; name: string; moduleId: string }[] = [];
	for (const population of atlas.populations) {
		const entry = { id: population.id, name: population.name, moduleId: population.moduleId };
		if (!moduleIds.has(population.moduleId)) {
			orphans.push(entry);
			continue;
		}
		const list = popsByModule.get(population.moduleId) ?? [];
		list.push(entry);
		popsByModule.set(population.moduleId, list);
	}

	const stack = new Set<string>();
	const roots = (childrenOf.get(null) ?? []).map((module) => measureModule(module, 0, childrenOf, popsByModule, stack));
	if (orphans.length > 0) {
		const size = blockSize(orphans.length, []);
		roots.push({
			id: UNPLACED_MODULE_ID,
			kind: "unplaced",
			name: "Unplaced",
			depth: 0,
			...size,
			populations: orphans,
			children: [],
		});
	}

	const modules: AtlasModuleBox[] = [];
	const populations: AtlasPopulationBox[] = [];
	if (roots.length === 0) {
		return { width: 0, height: 0, modules, populations, projections: [] };
	}
	let y = PAD;
	let maxWidth = 0;
	for (const root of roots) {
		place(root, PAD, y, modules, populations);
		y += root.height + MODULE_GAP;
		maxWidth = Math.max(maxWidth, root.width);
	}
	y -= MODULE_GAP;
	return {
		width: maxWidth + PAD * 2,
		height: y + PAD,
		modules,
		populations,
		projections: arrows(atlas, populations),
	};
}
