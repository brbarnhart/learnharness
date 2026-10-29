"use client";

import { useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The atlas-context card. Message[0] of a circuit lesson or an atlas
 * practice session. Collapsed and expanded, the learner sees record
 * names only — no pathway steps and no lesion result. The model reads
 * the marker's own text.
 */

export interface AtlasContextData {
	picks: { id: string; name: string; role?: string }[];
}

export function AtlasContextCard({ data, defaultOpen = false }: { data: AtlasContextData; defaultOpen?: boolean }) {
	const [open, setOpen] = useState(defaultOpen);
	const picks = data?.picks ?? [];
	const noun = picks.length === 1 ? "record" : "records";
	return (
		<div data-testid="atlas-context-card" className="my-1">
			<button
				type="button"
				data-testid="atlas-context-toggle"
				onClick={() => setOpen((value) => !value)}
				className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
			>
				<ChevronRightIcon aria-hidden="true" className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
				<span className="font-medium">Atlas context</span>
				<span className="shrink-0">
					{picks.length} {noun}
				</span>
				<span className="min-w-0 flex-1 truncate">{picks.map((pick) => pick.name).join(", ")}</span>
			</button>
			{open && (
				<div data-testid="atlas-context-body" className="mt-1 space-y-1 rounded-lg border border-dashed border-border/70 px-4 py-3 text-xs">
					{picks.map((pick) => (
						<div key={pick.id} data-testid={`atlas-context-pick-${pick.id}`} className="font-medium text-foreground/80">
							{pick.name}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
