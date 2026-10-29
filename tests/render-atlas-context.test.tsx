/**
 * The atlas-context card shows names only. Session find reads displayed
 * text, so a step that is absent from the markup cannot be found.
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AtlasContextCard } from "../components/atlas-context-card.tsx";
import { ProblemCard, ConcludeCard } from "../components/practice-cards.tsx";
import { findSessionTextMatches } from "../src/core/session-find.ts";

const STEP = "Direct-pathway MSNs —inhibitory→ GPi (prj_direct)";

describe("AtlasContextCard", () => {
	it("collapsed and expanded text is the record name", () => {
		const data = {
			picks: [
				{ id: "pwy_direct", name: "direct pathway", role: "redraw" },
				{ id: "pop_gpi", name: "GPi", role: "lesion" },
			],
		};
		const collapsed = renderToStaticMarkup(<AtlasContextCard data={data} />);
		const expanded = renderToStaticMarkup(<AtlasContextCard data={data} defaultOpen />);
		for (const html of [collapsed, expanded]) {
			assert.ok(html.includes("direct pathway"));
			assert.equal(html.includes(STEP), false);
			assert.equal(html.includes("redraw"), false);
			assert.equal(html.includes("lesion"), false);
			assert.equal(findSessionTextMatches(html, "prj_direct").length, 0);
		}
		assert.ok(expanded.includes('data-testid="atlas-context-body"'));
		assert.equal(collapsed.includes('data-testid="atlas-context-body"'), false);
	});
});

describe("problem and conclude cards", () => {
	it("the pose hides the atlas key and conclude reveals it", () => {
		const statement = "Redraw the direct pathway.";
		const problem = renderToStaticMarkup(
			<ProblemCard part={{ type: "tool-problem", toolCallId: "p1", state: "input-available", input: { statement, modelSolution: STEP } }} />,
		);
		assert.ok(problem.includes(statement));
		assert.equal(problem.includes("prj_direct"), false);
		const concluded = renderToStaticMarkup(
			<ConcludeCard
				part={{
					type: "tool-conclude",
					toolCallId: "c1",
					state: "output-available",
					input: { outcome: "solved", verdict: "Complete." },
					reveal: STEP,
				}}
			/>,
		);
		assert.ok(concluded.includes(STEP));
	});
});
