/**
 * AtlasStore — append-only JSONL ledgers at config.ATLAS_FILES.
 *
 * modules.jsonl, populations.jsonl, projections.jsonl, pathways.jsonl.
 * The fold (core/atlas.ts) is the read model: this adapter returns raw
 * JSON values and skips lines that are not JSON. Shape checks live in
 * the fold, which skips a line it cannot interpret.
 *
 * data/atlas/format.json is the family stamp. Absent = v1. A sidecar
 * newer than this build throws on read and on append.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ATLAS_FILES, ATLAS_FORMAT_FILE } from "../../config.ts";
import { CURRENT_ATLAS_FORMAT_VERSION } from "../core/contracts/atlas.ts";
import type {
	AtlasLedgers,
	AtlasModuleLine,
	AtlasPathwayLine,
	AtlasPopulationLine,
	AtlasProjectionLine,
} from "../core/contracts.ts";
import type { AtlasStore } from "../core/ports.ts";

function stampedVersion(): number | null {
	let raw: string;
	try {
		raw = fs.readFileSync(ATLAS_FORMAT_FILE, "utf-8");
	} catch {
		return null;
	}
	try {
		const parsed = JSON.parse(raw) as { version?: unknown };
		return typeof parsed.version === "number" && Number.isInteger(parsed.version) ? parsed.version : null;
	} catch {
		return null;
	}
}

function assertAtlasFormat(): void {
	const version = stampedVersion();
	if (version !== null && version > CURRENT_ATLAS_FORMAT_VERSION) {
		throw new Error(
			`Atlas data is stamped with format version ${version}, but this build understands only ${CURRENT_ATLAS_FORMAT_VERSION}. ` +
				"The app is older than its data — upgrade the app before touching the circuit atlas.",
		);
	}
}

function ensureAtlasFormat(): void {
	assertAtlasFormat();
	if (stampedVersion() !== null) return;
	fs.mkdirSync(path.dirname(ATLAS_FORMAT_FILE), { recursive: true });
	fs.writeFileSync(ATLAS_FORMAT_FILE, `${JSON.stringify({ version: CURRENT_ATLAS_FORMAT_VERSION }, null, "\t")}\n`, "utf-8");
}

function appendLine(file: string, record: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	ensureAtlasFormat();
	fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf-8");
}

function readRawLines(file: string): unknown[] {
	assertAtlasFormat();
	let raw: string;
	try {
		raw = fs.readFileSync(file, "utf-8");
	} catch {
		return [];
	}
	const out: unknown[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		try {
			out.push(JSON.parse(trimmed));
		} catch {
			// A torn or corrupt line never takes the atlas down with it.
		}
	}
	return out;
}

export const atlasStore: AtlasStore = {
	appendModule(line: AtlasModuleLine): void {
		appendLine(ATLAS_FILES.modules, line);
	},
	appendPopulation(line: AtlasPopulationLine): void {
		appendLine(ATLAS_FILES.populations, line);
	},
	appendProjection(line: AtlasProjectionLine): void {
		appendLine(ATLAS_FILES.projections, line);
	},
	appendPathway(line: AtlasPathwayLine): void {
		appendLine(ATLAS_FILES.pathways, line);
	},
	readLedgers(): AtlasLedgers {
		return {
			modules: readRawLines(ATLAS_FILES.modules),
			populations: readRawLines(ATLAS_FILES.populations),
			projections: readRawLines(ATLAS_FILES.projections),
			pathways: readRawLines(ATLAS_FILES.pathways),
		};
	},
};
