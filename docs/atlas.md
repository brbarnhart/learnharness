# Circuit atlas

Decided 2026-10-24. The proposition graph stays propositions and reasoning chains. Neural-circuit structure lives in this side store.

## What it stores

Four record types, one global atlas across sessions:

- A **module** is a named subsystem. Modules nest. Each module has a one-sentence purpose.
- A **population** is one cell class or nucleus, and it belongs to one module.
- A **projection** runs from one population to another. Its sign is excitatory, inhibitory, or modulatory. `feedback: true` means the teacher marked it as a return arc. That flag is not a cycle detector.
- A **pathway** is a name plus an ordered list of projections. The list is one contiguous chain: each projection's target is the next projection's source. Parallel bundles stay as projections inside a module.

The teacher is the identity judge. Creating a record always allocates a new id. Reusing an id is how a later session extends an existing record. Duplicate names are legal. There is no circuit auditor.

## How it is stored

Append-only JSONL under `data/atlas/`, separate from `data/graph/`. The first line for an id creates it. A later line with the same id is a correction: the fold keeps `createdAt` from the first line, takes the mutable fields from the last line, and unions provenance. A last line with `retired: true` drops the record from reads. A full line after a tombstone restores the record.

Retiring a population or projection does not rewrite pathways. A pathway that cites a missing projection, or whose steps no longer connect, folds with `brokenAt` set to the 1-based step.

The extractor does not read the atlas. A circuit fact becomes a proposition only when a circuit lesson says it in prose.

## What the functions answer

`foldAtlas` derives the live atlas. `prepareAtlasWrite` rejects cycles, unknown endpoints, self-projections, and pathways that are not one contiguous chain at the moment of the write. A later edit may still leave an existing pathway broken.

`lesion` is structural. For a population it lists projections that touch that population, the other populations that lose an incoming projection, and pathways whose chain included a removed projection. It does not predict symptoms.

`formatPathway` and `formatLesion` are the practice answer keys and the study-view text.

## Circuit lessons

A circuit lesson is a teach session with `domain: "circuit"`. Absence means a general lesson. Practice sessions do not carry the domain.

The circuit prompt is `src/agent/prompts/teacher/circuit.md`. The filename is not numeric, so the fragment loader does not add it to every teacher. It is appended only for a circuit teach session. The prober does not receive it.

The teacher tool `atlas` is registered only on those sessions. The prober on a circuit session gets a read-only `atlas_list`. General lessons get neither the tool nor the fragment. The teacher states each authored fact in lesson prose in the same turn. The extractor stays atlas-blind.

Teach on a selected module creates that circuit chat. Its first message is an atlas-context marker naming the module's id and name. The teacher lists the atlas for the rest.

## Atlas practice

A practice session started from the atlas is still `kind: "practice"`. It does not extract. The creation body carries pathway ids and population ids. The server looks up their names and writes an atlas-context marker. The marker lists ids and names. It does not list pathway steps or a lesion result. The card shows those names only. An atlas practice session does not also take proposition picks.

The practice prompt is `src/agent/prompts/practice/atlas.md`. The filename is not numeric. It is appended only when that marker is present.

`problem` accepts `atlasDemand`: a redraw of a picked pathway, or a lesion of a picked population. The server stores `formatPathway` or `formatLesion` as `modelSolution` and ignores a model-written solution. The learner sees the statement until conclude. The revealed solution is that stored key, including when the atlas is wrong. Home-graph practice is unchanged.
