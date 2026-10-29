/**
 * Circuit-atlas contracts — a side store beside the proposition graph.
 *
 * Neural-circuit structure (modules, populations, signed projections,
 * named pathways) lives here. The proposition graph stays propositions
 * and reasoning chains; this store is not a node kind on that graph.
 * Lines are append-only. The folded atlas is derived (core/atlas.ts).
 * Decisions: docs/atlas.md.
 */

/** Excitatory, inhibitory, or modulatory. Stored on the projection. */
export type AtlasSign = "excitatory" | "inhibitory" | "modulatory";

/** One authoring point — the tool call that appended the line. */
export interface AtlasProvenancePoint {
	chatId: string;
	messageId: string;
}

/**
 * A correction that drops the record. The last line for an id wins; a
 * tombstone as that last line omits the record from the folded atlas.
 * Provenance still unions through earlier lines when a later full line
 * restores it.
 */
export interface AtlasTombstone {
	id: string;
	retired: true;
	updatedAt: string;
	provenance: AtlasProvenancePoint[];
}

/** A named subsystem. `parentId` nests modules. Acyclic. */
export interface AtlasModuleRecord {
	id: string;
	name: string;
	/** Another module, or null at the root. */
	parentId: string | null;
	/** One sentence: what this subsystem is for. */
	purpose: string;
	createdAt: string;
	updatedAt: string;
	provenance: AtlasProvenancePoint[];
}

/** A cell class or nucleus inside exactly one module. */
export interface AtlasPopulationRecord {
	id: string;
	name: string;
	moduleId: string;
	/** Cell class, transmitter, or other short note. Absent when empty. */
	note?: string;
	createdAt: string;
	updatedAt: string;
	provenance: AtlasProvenancePoint[];
}

/** A directed connection between two populations. */
export interface AtlasProjectionRecord {
	id: string;
	name: string;
	fromId: string;
	toId: string;
	sign: AtlasSign;
	/**
	 * The teacher marked this projection as a return arc. This is not a
	 * cycle detector.
	 */
	feedback: boolean;
	note?: string;
	createdAt: string;
	updatedAt: string;
	provenance: AtlasProvenancePoint[];
}

/**
 * A named pathway: an ordered contiguous chain of projections. Contiguous
 * means each projection's target population is the next projection's source.
 * A bundle of parallel projections is a module, not a pathway.
 */
export interface AtlasPathwayRecord {
	id: string;
	name: string;
	projectionIds: string[];
	note?: string;
	createdAt: string;
	updatedAt: string;
	provenance: AtlasProvenancePoint[];
}

export type AtlasModuleLine = AtlasModuleRecord | AtlasTombstone;
export type AtlasPopulationLine = AtlasPopulationRecord | AtlasTombstone;
export type AtlasProjectionLine = AtlasProjectionRecord | AtlasTombstone;
export type AtlasPathwayLine = AtlasPathwayRecord | AtlasTombstone;

/** Folded module — live records only. */
export interface AtlasModule extends AtlasModuleRecord {}

export interface AtlasPopulation extends AtlasPopulationRecord {}

export interface AtlasProjection extends AtlasProjectionRecord {}

/**
 * A folded pathway. `brokenAt` is the 1-based step whose projection is
 * missing or whose source is not the previous step's target. Null when
 * the chain is intact. Retiring a projection does not rewrite the pathway;
 * the fold reports it broken instead.
 */
export interface AtlasPathway extends AtlasPathwayRecord {
	brokenAt: number | null;
}

/** The derived atlas. Reads omit retired records. */
export interface FoldedAtlas {
	modules: AtlasModule[];
	populations: AtlasPopulation[];
	projections: AtlasProjection[];
	pathways: AtlasPathway[];
}

/** The atlas-family format this build writes and understands (data/atlas/format.json). */
export const CURRENT_ATLAS_FORMAT_VERSION = 1;

/** Raw ledgers, append order. Unknown lines are skipped by the fold. */
export interface AtlasLedgers {
	modules: unknown[];
	populations: unknown[];
	projections: unknown[];
	pathways: unknown[];
}
