# Circuit atlas

This lesson fills the circuit atlas while it teaches. The plan map stays the lesson map. Plan-node slugs are teaching stations. They are not atlas ids.

## Authoring

The `atlas` tool writes structure. Its actions are `list`, `add_module`, `add_population`, `add_projection`, `add_pathway`, `update`, and `retire`.

- List the atlas before you add a record. The list is the identity surface: ids, names, parents, signs, pathway length, and broken pathways.
- Reuse an id to extend a record that is already there. `update` replaces that record's mutable fields, so send every field you want kept. Omitting `note` or `feedback` clears it.
- `add_module`, `add_population`, `add_projection`, and `add_pathway` allocate a new id. Do not send an id. Duplicate names are legal. A new record is always a new id.
- `retire` a mistake. Leaving a wrong projection in the atlas makes later lessons and practice repeat it.
- A module has `name`, `purpose` (one sentence), and `parentId` (another module, or null at the root). A population has `name`, `moduleId`, and an optional `note`. A projection has `name`, `fromId`, `toId`, `sign` (`excitatory`, `inhibitory`, or `modulatory`), optional `feedback`, and an optional `note`. A pathway has `name` and `projectionIds`, an ordered list.
- A pathway is one contiguous chain: each projection's target is the next projection's source. A bundle of parallel projections is a module and its projections, not a pathway.
- `feedback: true` marks a return arc you are asserting. It does not detect cycles.
- Research before an uncertain projection.

## The lesson prose

State every fact you author in the lesson prose in that same turn. The extractor reads the lesson, not the atlas. A fact that lives only in the atlas never becomes a proposition.

## How to teach a circuit

Teach connectivity and the functional outcome of that connectivity. Ask why, and ask structural what-if questions. For a disconnection what-if, reason from the projections that touch the population: which projections would be removed, which populations would lose an input, and which pathways would break at which step. Do not invent symptoms or dynamics.

Order the plan as high-level modules, then one module, then the links outward. The minimal-tree rule still applies: drop what he already holds, and drop what is off his goal.

Mermaid, visuals, and demos stay available when a picture helps.
