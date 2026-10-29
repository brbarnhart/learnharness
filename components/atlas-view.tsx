"use client";

/**
 * The circuit-atlas study view (/atlas).
 *
 * The learner reads the folded atlas. Edits stay on the teacher tools.
 * Teach opens a circuit teach chat titled with the one selected module.
 * Pathway and population selections are independent of that module: a
 * pathway highlight and a lesion card can sit alongside the Teach target.
 * Practice is a separate persistent selection of pathways and populations.
 *
 * The serif title is reserved for sessions (owner round 11). This bar
 * carries a muted "Atlas" label, the same register as the chain table.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/top-bar";
import { cn } from "@/lib/utils";
import { ATLAS_PRACTICE_CAP, formatLesion, layoutAtlas } from "@/src/core";
import type { AtlasLayout, AtlasProjectionArrow, FoldedAtlas } from "@/src/core";

const TEACH_FAILED = "The circuit lesson could not be started.";
const PRACTICE_FAILED = "The practice session could not be started.";

/**
 * Creates the circuit teach chat for one module. The server writes the
 * atlas-context marker from the module id and the atlas's own name.
 */
export async function startAtlasTeach(
	module: { id: string; name: string },
	fetchLike: typeof fetch,
): Promise<{ ok: true; href: string } | { ok: false; error: string }> {
	try {
		const res = await fetchLike("/api/chats", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: module.name, domain: "circuit", atlasContext: { moduleId: module.id } }),
		});
		if (!res.ok) return { ok: false, error: TEACH_FAILED };
		const body = (await res.json()) as { id?: unknown };
		if (typeof body.id !== "string" || body.id.length === 0) return { ok: false, error: TEACH_FAILED };
		return { ok: true, href: `/chat/${body.id}` };
	} catch {
		return { ok: false, error: TEACH_FAILED };
	}
}

/**
 * Creates an atlas practice chat. The server resolves names. Proposition
 * picks are not sent.
 */
export async function startAtlasPractice(
	title: string,
	pathwayIds: readonly string[],
	populationIds: readonly string[],
	fetchLike: typeof fetch,
): Promise<{ ok: true; href: string } | { ok: false; error: string }> {
	try {
		const res = await fetchLike("/api/chats", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title,
				kind: "practice",
				atlasContext: { pathwayIds, populationIds },
			}),
		});
		if (!res.ok) return { ok: false, error: PRACTICE_FAILED };
		const body = (await res.json()) as { id?: unknown };
		if (typeof body.id !== "string" || body.id.length === 0) return { ok: false, error: PRACTICE_FAILED };
		return { ok: true, href: `/chat/${body.id}` };
	} catch {
		return { ok: false, error: PRACTICE_FAILED };
	}
}

/** Toggle one practice pick. At the cap, a new id is refused. Re-clicking removes it. */
export function nextPracticeIds(current: readonly string[], id: string, cap = ATLAS_PRACTICE_CAP): readonly string[] {
	if (current.includes(id)) return current.filter((item) => item !== id);
	if (current.length >= cap) return current;
	return [...current, id];
}

function arrowHead(arrow: AtlasProjectionArrow): string {
	const dx = arrow.x2 - arrow.x1;
	const dy = arrow.y2 - arrow.y1;
	const len = Math.hypot(dx, dy) || 1;
	const ux = dx / len;
	const uy = dy / len;
	const px = -uy;
	const py = ux;
	const baseX = arrow.x2 - ux * 9;
	const baseY = arrow.y2 - uy * 9;
	return `M ${baseX + px * 3.5} ${baseY + py * 3.5} L ${arrow.x2} ${arrow.y2} L ${baseX - px * 3.5} ${baseY - py * 3.5}`;
}

function onActivate(event: React.KeyboardEvent, action: () => void) {
	if (event.key !== "Enter" && event.key !== " ") return;
	event.preventDefault();
	action();
}

/** Presentational map. Selection and navigation live in the parent, so a render test does not mount a router. */
export function AtlasCanvas({
	layout,
	selectedModuleId,
	selectedPopulationId,
	highlightedProjectionIds,
	onSelectModule,
	onSelectPopulation,
}: {
	layout: AtlasLayout;
	selectedModuleId: string | null;
	selectedPopulationId: string | null;
	/** Null when no pathway is selected, so nothing is dimmed. */
	highlightedProjectionIds: ReadonlySet<string> | null;
	onSelectModule: (id: string) => void;
	onSelectPopulation: (id: string) => void;
}) {
	return (
		<svg
			data-testid="atlas-canvas"
			width={layout.width}
			height={layout.height}
			viewBox={`0 0 ${layout.width} ${layout.height}`}
			role="img"
			aria-label="Circuit atlas"
			className="block"
		>
			{layout.modules.map((box) => {
				const selectable = box.kind === "module";
				const selected = selectable && box.id === selectedModuleId;
				return (
					<g
						key={box.id}
						data-testid="atlas-module"
						data-module-id={box.id}
						data-kind={box.kind}
						data-selected={selected ? "true" : "false"}
						role={selectable ? "button" : undefined}
						tabIndex={selectable ? 0 : undefined}
						aria-label={selectable ? box.name : undefined}
						aria-pressed={selectable ? selected : undefined}
						className={selectable ? "cursor-pointer" : undefined}
						onClick={selectable ? () => onSelectModule(box.id) : undefined}
						onKeyDown={selectable ? (event) => onActivate(event, () => onSelectModule(box.id)) : undefined}
					>
						<rect
							x={box.x}
							y={box.y}
							width={box.width}
							height={box.height}
							rx={8}
							strokeWidth={selected ? 2 : 1}
							className={cn(box.depth === 0 ? "fill-card" : "fill-background", selected ? "stroke-primary" : "stroke-border")}
						/>
						<text x={box.x + 12} y={box.y + 18} fontSize={13} className="fill-foreground">
							{box.name}
						</text>
					</g>
				);
			})}
			{layout.projections.map((arrow) => {
				const dimmed = highlightedProjectionIds !== null && !highlightedProjectionIds.has(arrow.id);
				return (
					<g
						key={arrow.id}
						data-testid="atlas-projection"
						data-projection-id={arrow.id}
						data-sign={arrow.sign}
						data-feedback={arrow.feedback ? "true" : "false"}
						data-dimmed={dimmed ? "true" : "false"}
						className={dimmed ? "opacity-25" : undefined}
						pointerEvents="none"
					>
						<line
							x1={arrow.x1}
							y1={arrow.y1}
							x2={arrow.x2}
							y2={arrow.y2}
							strokeWidth={1.5}
							strokeDasharray={arrow.feedback ? "6 4" : undefined}
							className="stroke-foreground"
						/>
						<path d={arrowHead(arrow)} fill="none" strokeWidth={1.5} className="stroke-foreground" />
						<text x={arrow.labelX} y={arrow.labelY - 6} textAnchor="middle" fontSize={11} className="fill-foreground">
							{arrow.sign}
						</text>
					</g>
				);
			})}
			{layout.populations.map((population) => {
				const selected = population.id === selectedPopulationId;
				return (
					<g
						key={population.id}
						data-testid="atlas-population"
						data-population-id={population.id}
						data-selected={selected ? "true" : "false"}
						role="button"
						tabIndex={0}
						aria-label={population.name}
						aria-pressed={selected}
						className="cursor-pointer"
						onClick={() => onSelectPopulation(population.id)}
						onKeyDown={(event) => onActivate(event, () => onSelectPopulation(population.id))}
					>
						<rect
							x={population.x}
							y={population.y}
							width={population.width}
							height={population.height}
							rx={6}
							strokeWidth={selected ? 2 : 1}
							className={cn("fill-background", selected ? "stroke-primary" : "stroke-border")}
						/>
						<text
							x={population.x + population.width / 2}
							y={population.y + population.height / 2}
							textAnchor="middle"
							dominantBaseline="middle"
							fontSize={11}
							className="fill-foreground"
						>
							{population.name}
						</text>
					</g>
				);
			})}
		</svg>
	);
}

/** The study surface without a router: the bar, the map, the lesion card, and Teach. */
export function AtlasStudy({
	atlas,
	selectedModuleId,
	selectedPopulationId,
	selectedPathwayId,
	onSelectModule,
	onSelectPopulation,
	onSelectPathway,
	onTeach,
	teachBusy,
	teachError,
	practiceIds,
	onTogglePractice,
	onClearPractice,
	onPractice,
	practiceBusy,
	practiceError,
}: {
	atlas: FoldedAtlas;
	selectedModuleId: string | null;
	selectedPopulationId: string | null;
	selectedPathwayId: string | null;
	onSelectModule: (id: string) => void;
	onSelectPopulation: (id: string) => void;
	onSelectPathway: (id: string) => void;
	onTeach: () => void;
	teachBusy: boolean;
	teachError: string | null;
	practiceIds: readonly string[];
	onTogglePractice: (id: string) => void;
	onClearPractice: () => void;
	onPractice: () => void;
	practiceBusy: boolean;
	practiceError: string | null;
}) {
	const layout = layoutAtlas(atlas);
	const selectedModule = atlas.modules.find((module) => module.id === selectedModuleId) ?? null;
	const pathway = atlas.pathways.find((item) => item.id === selectedPathwayId) ?? null;
	const highlighted = pathway === null ? null : new Set(pathway.projectionIds);
	const lesionText = selectedPopulationId === null ? null : formatLesion(atlas, selectedPopulationId);
	const empty = atlas.modules.length === 0 && atlas.populations.length === 0 && atlas.projections.length === 0 && atlas.pathways.length === 0;
	const practiceFull = practiceIds.length >= ATLAS_PRACTICE_CAP;
	const practicePicked = (id: string) => practiceIds.includes(id);

	return (
		<div data-testid="atlas-page" className="flex h-dvh min-h-0 flex-col">
			<TopBar>
				<span className="min-w-0 truncate text-xs text-muted-foreground">Atlas</span>
				<div className="flex-1" />
				{teachError && (
					<span data-testid="atlas-teach-error" className="min-w-0 truncate text-xs text-destructive">
						{teachError}
					</span>
				)}
				{practiceError && (
					<span data-testid="atlas-practice-error" className="min-w-0 truncate text-xs text-destructive">
						{practiceError}
					</span>
				)}
				{practiceIds.length > 0 && (
					<span data-testid="atlas-practice-count" className="shrink-0 text-xs text-muted-foreground">
						{practiceIds.length} selected
					</span>
				)}
				{practiceIds.length > 0 && (
					<Button type="button" size="sm" variant="ghost" data-testid="atlas-practice-clear" onClick={onClearPractice} className="lh-no-drag">
						Clear
					</Button>
				)}
				<Button
					type="button"
					size="sm"
					variant="outline"
					data-testid="atlas-practice"
					disabled={practiceBusy || practiceIds.length === 0}
					onClick={onPractice}
					className="lh-no-drag"
				>
					Practice
				</Button>
				<Button
					type="button"
					size="sm"
					data-testid="atlas-teach"
					disabled={teachBusy || selectedModule === null}
					onClick={onTeach}
					className="lh-no-drag"
				>
					Teach
				</Button>
			</TopBar>
			{empty ? (
				<p data-testid="atlas-empty" className="p-8 text-sm text-muted-foreground">
					Circuit lessons fill the atlas. Nothing is here yet.
				</p>
			) : (
				<div className="flex min-h-0 flex-1 flex-col lg:flex-row">
					<div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
						{layout.modules.length > 0 && (
							<AtlasCanvas
								layout={layout}
								selectedModuleId={selectedModuleId}
								selectedPopulationId={selectedPopulationId}
								highlightedProjectionIds={highlighted}
								onSelectModule={onSelectModule}
								onSelectPopulation={onSelectPopulation}
							/>
						)}
					</div>
					<aside
						data-testid="atlas-side"
						className="max-h-[45%] shrink-0 overflow-auto border-t border-border p-4 lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l"
					>
						{selectedModule && (
							<div data-testid="atlas-module-card">
								<p className="text-sm">{selectedModule.name}</p>
								<p className="mt-1 text-xs text-muted-foreground">{selectedModule.purpose}</p>
							</div>
						)}
						{lesionText !== null && (
							<pre data-testid="lesion-card" className="mt-4 whitespace-pre-wrap font-mono text-xs">{lesionText}</pre>
						)}
						{atlas.pathways.length > 0 && (
							<div className={selectedModule || lesionText !== null ? "mt-4" : undefined}>
								<p className="text-xs text-muted-foreground">Pathways</p>
								<ul className="mt-2 flex flex-col gap-1">
									{atlas.pathways.map((item) => (
										<li key={item.id} className="flex items-center gap-1">
											<button
												type="button"
												data-testid="atlas-practice-pick"
												data-record-id={item.id}
												aria-label={`Practice ${item.name}`}
												aria-pressed={practicePicked(item.id)}
												disabled={practiceFull && !practicePicked(item.id)}
												onClick={() => onTogglePractice(item.id)}
												className={cn(
													"size-3.5 shrink-0 rounded-sm border",
													practicePicked(item.id) ? "border-primary bg-primary" : "border-border",
												)}
											/>
											<button
												type="button"
												data-testid="atlas-pathway"
												data-pathway-id={item.id}
												aria-pressed={item.id === selectedPathwayId}
												onClick={() => onSelectPathway(item.id)}
												className={cn(
													"w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent",
													item.id === selectedPathwayId && "bg-accent",
												)}
											>
												{item.name}
												{item.brokenAt !== null ? ` — broken at step ${item.brokenAt}` : ""}
											</button>
										</li>
									))}
								</ul>
							</div>
						)}
						{atlas.populations.length > 0 && (
							<div className="mt-4">
								<p className="text-xs text-muted-foreground">Populations</p>
								<ul className="mt-2 flex flex-col gap-1">
									{atlas.populations.map((item) => (
										<li key={item.id}>
											<button
												type="button"
												data-testid="atlas-practice-pick"
												data-record-id={item.id}
												aria-pressed={practicePicked(item.id)}
												disabled={practiceFull && !practicePicked(item.id)}
												onClick={() => onTogglePractice(item.id)}
												className={cn(
													"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent",
													practicePicked(item.id) && "bg-accent",
												)}
											>
												<span
													aria-hidden="true"
													className={cn(
														"size-3.5 shrink-0 rounded-sm border",
														practicePicked(item.id) ? "border-primary bg-primary" : "border-border",
													)}
												/>
												{item.name}
											</button>
										</li>
									))}
								</ul>
							</div>
						)}
					</aside>
				</div>
			)}
		</div>
	);
}

/**
 * Owns selection. The three picks do not clear each other: Teach needs one
 * module, a population shows the lesion card, and a pathway dims every
 * projection outside its chain. Re-clicking a pick clears that pick only.
 */
export function AtlasView({ atlas }: { atlas: FoldedAtlas }) {
	const router = useRouter();
	const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
	const [selectedPopulationId, setSelectedPopulationId] = useState<string | null>(null);
	const [selectedPathwayId, setSelectedPathwayId] = useState<string | null>(null);
	const [teachBusy, setTeachBusy] = useState(false);
	const [teachError, setTeachError] = useState<string | null>(null);
	const [practiceIds, setPracticeIds] = useState<readonly string[]>([]);
	const [practiceBusy, setPracticeBusy] = useState(false);
	const [practiceError, setPracticeError] = useState<string | null>(null);

	const teach = async () => {
		const module = atlas.modules.find((item) => item.id === selectedModuleId);
		if (!module || teachBusy) return;
		setTeachBusy(true);
		setTeachError(null);
		const result = await startAtlasTeach(module, fetch);
		if (!result.ok) {
			setTeachError(result.error);
			setTeachBusy(false);
			return;
		}
		router.push(result.href);
	};

	const practice = async () => {
		if (practiceIds.length === 0 || practiceBusy) return;
		const pathwayIds = practiceIds.filter((id) => atlas.pathways.some((item) => item.id === id));
		const populationIds = practiceIds.filter((id) => atlas.populations.some((item) => item.id === id));
		const names = practiceIds.map(
			(id) => atlas.pathways.find((item) => item.id === id)?.name ?? atlas.populations.find((item) => item.id === id)?.name ?? id,
		);
		setPracticeBusy(true);
		setPracticeError(null);
		const result = await startAtlasPractice(names.join(", "), pathwayIds, populationIds, fetch);
		if (!result.ok) {
			setPracticeError(result.error);
			setPracticeBusy(false);
			return;
		}
		router.push(result.href);
	};

	const toggle = (current: string | null, id: string) => (current === id ? null : id);

	return (
		<AtlasStudy
			atlas={atlas}
			selectedModuleId={selectedModuleId}
			selectedPopulationId={selectedPopulationId}
			selectedPathwayId={selectedPathwayId}
			onSelectModule={(id) => setSelectedModuleId((current) => toggle(current, id))}
			onSelectPopulation={(id) => setSelectedPopulationId((current) => toggle(current, id))}
			onSelectPathway={(id) => setSelectedPathwayId((current) => toggle(current, id))}
			onTeach={() => void teach()}
			teachBusy={teachBusy}
			teachError={teachError}
			practiceIds={practiceIds}
			onTogglePractice={(id) => setPracticeIds((current) => nextPracticeIds(current, id))}
			onClearPractice={() => setPracticeIds([])}
			onPractice={() => void practice()}
			practiceBusy={practiceBusy}
			practiceError={practiceError}
		/>
	);
}
