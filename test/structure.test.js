// Structural tests: they read the repository as text and refuse a shape. Nothing here
// exercises behaviour, so a failure names a rule rather than a bug — the rules are the ones
// written down in AGENTS.md, and a rule nothing checks is a rule that drifts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const tracked = (pattern) =>
  spawnSync('git', ['ls-files', pattern], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);

const skills = readdirSync(join(root, 'skills'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

// The frontmatter is the whole contract with both harnesses: Claude matches on `description`
// and Codex lists the directory. An extra key is ignored silently, and a `name` that drifts
// from its directory makes the skill unaddressable by the name it advertises.
test('every skill is a directory with a SKILL.md carrying exactly name and description', () => {
  assert.ok(skills.length > 0, 'no skills found');
  for (const skill of skills) {
    const path = `skills/${skill}/SKILL.md`;
    assert.ok(existsSync(join(root, path)), `${skill} has no SKILL.md`);
    const [, frontmatter] = read(path).split(/^---$/m);
    assert.ok(frontmatter, `${path} has no YAML frontmatter`);
    const keys = frontmatter
      .split('\n')
      .map((line) => line.match(/^([A-Za-z_-]+):/))
      .filter(Boolean)
      .map((m) => m[1]);
    assert.deepEqual(keys.sort(), ['description', 'name'], `${path} frontmatter keys`);
    assert.equal(frontmatter.match(/^name: *(.+)$/m)[1].trim(), skill, `${path} name must match its directory`);
  }
});

// A description is the trigger, not a summary: the agent reads it to decide whether to fire.
// "Use when the user asks about …" is the form that works; a noun phrase describing the skill
// leaves the harness guessing.
test('every skill description opens with its trigger', () => {
  for (const skill of skills) {
    const description = read(`skills/${skill}/SKILL.md`).match(/^description: *["']?(.+)$/m)[1];
    assert.match(description, /^Use (when|WHENEVER|whenever)\b/, `skills/${skill}: description must open with "Use when"`);
  }
});

// The rules every skill shares live in one file, so one edit changes every skill. A skill that
// does not point at it answers without those rules, and a section copied back into a skill is
// a second copy that drifts.
test('every skill reads the shared rules, and no skill holds its own copy', () => {
  const shared = read('skills/cxm-shared-rules.md');
  const headings = shared.match(/^## .+$/gm);
  assert.ok(headings?.length, 'skills/cxm-shared-rules.md has no ## section');
  for (const skill of skills) {
    const text = read(`skills/${skill}/SKILL.md`);
    assert.ok(text.includes('../cxm-shared-rules.md'), `skills/${skill}: must tell the agent to read ../cxm-shared-rules.md`);
    for (const heading of headings) {
      assert.ok(!text.split('\n').includes(heading), `skills/${skill}: "${heading}" belongs in skills/cxm-shared-rules.md only`);
    }
  }
});

// Every backend host derives from the one base URL the user gives at setup, so a hostname
// written anywhere else is a second source of truth that staging and local development then
// disagree with. Two files may hold it: the deriver, and the default offered at the prompt.
test('the backend hostname lives in two files and nowhere else', () => {
  const allowed = new Set(['src/lib/urls.js', 'src/lib/prompt.js']);
  const offenders = tracked('*')
    .filter((p) => /^(bin|src|skills|hooks|commands|scripts)\//.test(p))
    .filter((p) => !allowed.has(p))
    .filter((p) => /\bcloudexmachina\.(io|com)\b/.test(read(p)));
  assert.deepEqual(offenders, [], 'derive the host from config.baseUrl instead — src/lib/urls.js');
});

// `node --test` only parses the files a test imports. The hook scripts, the release tooling
// and any command nothing covers yet are reached by this and by nothing else, and a syntax
// error in one of them fails at a user's session start rather than here.
test('every tracked JavaScript file parses', () => {
  const files = tracked('*').filter((p) => /\.(js|mjs)$/.test(p));
  assert.ok(files.length > 10, 'expected to find the sources');
  const broken = files.filter((p) => spawnSync(process.execPath, ['--check', join(root, p)]).status !== 0);
  assert.deepEqual(broken, [], 'these files do not parse');
});

// Neither harness is the primary one. The two plugin manifests are written by hand and read by
// different agents, so a field edited in one and forgotten in the other ships a version where
// Codex advertises the old description, or the old version, and nothing fails until a user sees
// it. The Claude manifest finds the skills by convention and the Codex manifest names the path;
// both must land on the same directory.
test('both harness manifests describe the same plugin', () => {
  const claude = JSON.parse(read('.claude-plugin/plugin.json'));
  const codex = JSON.parse(read('.codex-plugin/plugin.json'));
  for (const field of ['name', 'version', 'description', 'license']) {
    assert.equal(codex[field], claude[field], `.codex-plugin/plugin.json ${field} disagrees with the Claude manifest`);
  }
  assert.ok(codex.skills, '.codex-plugin/plugin.json must name the skills directory — Codex does not discover it');
  assert.equal(
    resolve(root, codex.skills),
    resolve(root, 'skills'),
    'Codex must be pointed at the same skills/ directory the Claude plugin root exposes',
  );
});

// Add a name with: node -e "console.log(require('crypto').createHash('sha256').update('<word>').digest('hex').slice(0,16))"
const hash = (word) => createHash('sha256').update(word).digest('hex').slice(0, 16);
const words = (text) => text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
const INTERNAL_NAMES = new Set([
  '253f7ea627b61fd6', 'ef4008aa30372b67', '279aab5e32373811', '084328c53a9de563', '1f6bc2d1c36c2733', '5b695e56fb243ca6',
  '36c0c6b32a5cdcbe', 'f3ebc350c88c05e1', 'b612467da0474aef', 'd6bed788702b9a65', '6aee0e678a168eea', '6366233f6ef38437',
]);
// Prefixes of internal cube names, hashed without the trailing underscore.
const INTERNAL_DATASET_PREFIXES = new Set(['084328c53a9de563', '64855c96d1f465cf', '8fb611669b2d6664']);

test('no internal technology name reaches shipped text', () => {
  const offenders = tracked('*')
    .filter((p) => /^(bin|src|skills|hooks|commands|scripts|docs)\//.test(p) || /^[A-Z]+\.md$/.test(p))
    .filter((p) => words(read(p)).some((w) => INTERNAL_NAMES.has(hash(w))));
  assert.deepEqual(offenders, [], 'name the capability, not the service behind it — see src/AGENTS.md');
});

// Datasets are the views the platform publishes; a cube name with an internal part leaks internal tech.
test('no tracked file names an internal dataset', () => {
  const offenders = tracked('*')
    .filter((p) => /\.(js|mjs|md|json)$/.test(p))
    .filter((p) => words(read(p)).some((w) => w.includes('_') && w.split('_').some((part) => INTERNAL_DATASET_PREFIXES.has(hash(part)))));
  assert.deepEqual(offenders, [], 'query the dataset by its published name (cxm analytics schema), not the cube behind it');
});

// The Node floor is declared twice — package.json "engines" and the startup guard — and they must
// agree, or the guard waves through a version the code cannot run, or blocks one it can.
test('the Node guard threshold matches package.json engines', () => {
  const floor = JSON.parse(read('package.json')).engines.node.match(/(\d+)/)[1];
  const guard = read('src/lib/node-guard.js').match(/MIN_MAJOR\s*=\s*(\d+)/)[1];
  assert.equal(guard, floor, 'src/lib/node-guard.js MIN_MAJOR must equal package.json engines.node');
});

// `files` is what npm puts in the tarball. A directory the plugin loads from and the tarball
// omits is a published version that is broken for `npx` users only — the marketplace installs
// from git and never notices.
test('package.json files covers every directory the plugin loads from', () => {
  const { files } = JSON.parse(read('package.json'));
  for (const dir of ['bin', 'src', 'skills', 'hooks', 'commands', 'scripts', '.claude-plugin', '.codex-plugin']) {
    assert.ok(existsSync(join(root, dir)), `${dir} is gone — drop it from this list too`);
    assert.ok(files.includes(dir), `package.json "files" omits ${dir}, so npx installs would not get it`);
  }
});
