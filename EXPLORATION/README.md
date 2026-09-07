# EXPLORATION

The analysis of the IQP export that produced this project's design. Written before any code existed,
kept because the reasoning is still the justification for what was built.

**All of it is anonymised**, and must stay that way: the quoted excerpts are real in structure and
scrubbed of every client name, project code, ticket prefix, pod tenant code, username and personal
name. Nothing here should be regenerated from a live export directly into this directory.

| File | What it answers |
|---|---|
| `00-inventory.md` | What is physically in an IQP export: file types, sizes, formats, anomalies. No interpretation. |
| `01-data-model.md` | How IQP represents a test. The full action vocabulary with frequencies, where locators live, whether semantic anchors survive, how lists of values and synchronisation are encoded. Quoted evidence throughout. This is the reference for anyone touching `tools/convert-iqp.ts`. |
| `02-translatability-report.md` | The measured verdict: what fraction of an IQP corpus converts mechanically, what needs inference, what cannot be carried at all, plus the risk register. This is the gate that authorised the build. |
| `04-pilot-notes.md` | What the schema learned during the pilot conversion: v0 to v0.1 changes, which inferred labels were corrected by hand, and what remains unverified until a live run. |

## Why there is no 03

`03-conversion-report.md` used to sit here. It is a **generated** artefact: `tools/convert-iqp.ts`
produces it on every run and it quotes the source export verbatim, which makes it client derived.
It now goes to `<workspace>/reports/conversion-report.md`, outside this repository.

The numbering is left with a gap on purpose, as a reminder of the rule it enforces: **`EXPLORATION/`
is documentation, never an output directory.** Anything a tool generates from real client material
belongs in the workspace or in `reports/`.
