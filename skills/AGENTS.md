<!-- bmad:context -->
<!-- Verified 2026-10-02 against 5623e6e. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## skills/

The skills both harnesses ship. One directory per skill, no generated copy: Claude reads them
through the plugin root and Codex through `"skills": "./skills/"` in
`.codex-plugin/plugin.json`, so there is one source and nothing to sync.

## Conventions that differ from defaults

- A skill is `skills/<name>/SKILL.md` with YAML frontmatter carrying exactly `name` and
  `description`, and `name` matches the directory. Renaming the directory means renaming both.
  `test/structure.test.js` refuses any other shape.
- `description` is the trigger, not a summary — it must open with "Use when" and name the user
  phrasings that should fire it. The harness decides whether to load the skill from this line
  alone.
- A skill reaches live data by shelling out to `cxm`, never by writing a hostname. The hosts all
  derive from the one base URL stored at setup; the structural test refuses a hostname anywhere
  but `src/lib/urls.js` and `src/lib/prompt.js`.
- Adding a skill needs no index edit. `cxm init` lists this directory, and the two plugin
  manifests point at it.

## Known pitfalls

- Skill prompts are product-facing text. No customer name, and no partner or vendor name, in
  anything a user reads — say "your team", "this workspace", "your organization". Attribution
  belongs in metadata: `author` in the plugin manifests and `owner` in
  `.claude-plugin/marketplace.json`. Naming the product being queried, or the tool being driven,
  is not a breach of this: a skill that cannot say `cxm cube` cannot be followed.

<!-- /bmad:context -->

## Shared rules

- The rules every skill follows — how to query CXM and how to answer — live in
  `skills/cxm-shared-rules.md`. Every `SKILL.md` tells the agent to read `../cxm-shared-rules.md`
  first. Change a shared rule there, once. A rule for one skill goes in that skill.
- `test/structure.test.js` refuses a skill without the pointer, and a skill that copies a
  `## ` section of the shared file back in.
- The file name carries the `cxm-` prefix because `cxm init` copies every entry of `skills/` into
  the user's skills folder and replaces an entry with the same name.
