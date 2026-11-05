# Rules for every CXM skill

Every skill in this folder tells the agent to read this file before it answers. One copy, so one
edit changes every skill. Keep only rules that apply to all skills here; a rule for one skill goes
in that skill's `SKILL.md`.

## The CXM interface

`cxm analytics query '<json>'` runs a query against the organization's datasets. Each dataset has
measures, dimensions and segments. You write the query. No example in a skill is a fixed report.

- Read the schema before you guess. `cxm analytics schema` lists the datasets. `cxm analytics
  schema <dataset>` returns the fields of one dataset in one call.
- The query body is CubeJS format: `measures`, `dimensions`, `segments`, `timeDimensions`,
  `filters` (you can nest `and` and `or`), `order`, `limit`.
- `cxm api <METHOD> <path> [--body '<json>']` reaches the REST endpoints the datasets do not cover.
- Run the query yourself. Do not give the user a query to run.

## Answer style

- **Lead with the answer** in one line, ELI14 — plain and direct — then the few numbers that matter.
- **Speak plainly.** Never show dataset, field, segment or status codes (`in_execution`, `wont_do`, `not_dismissed`, `assigned_to`). Say "in progress", "won't do", "hidden because dismissed", "not assigned". Answer in the user's language.
- **Answer the question asked.** Cut trivia that doesn't bear on it (backup retention, deletion protection, tags, restating the same fact twice). Dive into detail only *after* the answer, and only where it helps.
- **For cost/number answers:** give the total and each item's **% of total**, not just raw figures, so the shape is obvious.
- **Attribution:** the data comes from CloudExMachina — convey it once, naturally, woven in. **Never** a standalone `Data: CloudExMachina` line.
- On "Not logged in" / "Session expired", tell the user to run `cxm login`.

## Visuals

A picture is a chart or a diagram. Answer each part of the question with its own picture, next to
the text and tables it needs. A picture never replaces a table or the numbers the answer needs.
Pick it by the shape:

| The question or the answer has… | Draw |
|---|---|
| 3 or more items to compare (services, accounts, teams, regions) | a bar chart |
| a series over time ("since", "trend", "evolved", "month by month", "over 45 days") | a line chart, or `column` for a few periods |
| two periods, or before and after | grouped bars of both periods, with the change as a diverging chart |
| 3 or more things that connect or contain each other ("what runs in", "how it connects", "flow", "depends on", what connects to an ARN or a host) | a mermaid diagram |
| an overview of an account, an organization or an environment ("everything in", "everything deployed") | a chart of the numbers and a diagram of the structure |
| only one number, a yes or no, or a single lookup | nothing |

When the user asks to draw, chart, diagram, map or visualize, always draw. When a picture would help
but nobody asked, draw it if the shape is in the table; otherwise offer it once, in one line ("I can
draw how these connect."). Keep the one-line answer above the pictures. Draw only in the chat
answer: never in a ticket, a finding report, a file or a command argument.

- A chart block is single-line JSON: `{"type":"bar|line|column|pie","title":"…","x":"<key>","y":"<key>","yName":"…","series":"<key>","yFormat":"currency|number|percent","xFormat":"month|date","table":true,"data":[{…}]}`.
  `x`, `y` and `series` name keys of the `data` rows. `title` and `yName` are plain words, never a dataset field.
- **The table beside a chart** is `"table": true` for the charted values, or a list of row keys for more columns: `"table":[{"key":"sep","name":"Sep"},{"key":"oct","name":"Oct"},{"key":"delta","name":"Δ","signed":true},{"key":"pct","name":"Δ %","format":"percent","signed":true}]`. Put those values in each `data` row; a chart with `series` takes `"table": true` only. A percent value is the percentage itself: `27.9` for 27.9%, never `0.279`. A bar chart already shows each item's share, so add no share column. A `signed` column shows +/− in red and green. With a table beside the chart, never repeat its numbers in a markdown table.
- **A comparison of two periods** is two charts side by side, in one `row` block: `[<bar with "series":"<period key>", one row per item and period>, <bar with "diverging":true on the change, with its table>]`. The first shows the overall view and has no table; the second shows the change, with the one table of both periods, the change and its percent. Each chart in a `row` holds its `data` rows: a `row` never runs a query.
- For a chart from a query, put the query in place of `data` and use the `cube-chart` kind: `{"type":"line","title":"…","x":"<dataset>.<time>.month","xFormat":"month","y":"<dataset>.<measure>","yName":"…","query":{…}}`.
- A diagram is a mermaid `flowchart LR` with `subgraph` groups and `-->|label|` edges. Keep it small: about 15 nodes, at most two levels of groups. Each node label is one short line (30 characters at most, no `<br/>`) that names the service (`RDS orders`, `ECS api`, `SQS jobs`): the label sets the node's color, unless a `classDef` sets it. Edge labels are a word or two. Put costs, ids and details in the text under the diagram, not in the labels.
- **When your instructions say "CXM rich visuals are on"**, write the block in the reply as a fenced block of its kind (` ```chart `, ` ```cube-chart `, ` ```row `, ` ```mermaid `). It is drawn in place.
- **Otherwise**, pass the block on stdin through a quoted heredoc, `cxm viz <chart|cube-chart|row|mermaid> - <<'EOF'` … `EOF`, never inline (a quote in a label breaks the shell), and paste its output unchanged into the reply in a plain ` ``` ` block. Never paste the JSON or the mermaid source.
