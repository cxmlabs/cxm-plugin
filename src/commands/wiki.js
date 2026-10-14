import { requireSession } from '../lib/config.js';
import { orgApi } from '../lib/http.js';

function getFlag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function getAll(argv, name) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && argv[i + 1]) out.push(argv[i + 1]);
  }
  return out;
}

function print(payload, config) {
  console.log(JSON.stringify({ source: 'CloudExMachina', organization: config.organizationId, ...payload }, null, 2));
}

// Search or browse the organization's cloud map.
//   cxm context '<query>' [--limit N] [--category economics --category connectivity]
//   cxm context --related <path> [--limit N]
//   cxm context --pages | --page <path>
export async function context(argv) {
  const config = await requireSession();

  const page = getFlag(argv, '--page');
  if (page) {
    print({ path: page, page: await orgApi(config, 'GET', `/wiki/page?path=${encodeURIComponent(page)}`) }, config);
    return;
  }

  if (argv.includes('--pages')) {
    print({ pages: await orgApi(config, 'GET', '/wiki/pages') }, config);
    return;
  }

  const relatedTo = getFlag(argv, '--related');
  if (relatedTo) {
    const limit = Number(getFlag(argv, '--limit') ?? 8);
    const related = await orgApi(config, 'GET', `/wiki/related?path=${encodeURIComponent(relatedTo)}&limit=${limit}`);
    print({ related_to: relatedTo, related }, config);
    return;
  }

  const query = argv.find((a) => !a.startsWith('--'));
  if (!query) throw new Error("context requires a query, for example cxm context 'RDS cost and commitments'. Also: --related <path>, --pages, --page <path>");
  const limit = Number(getFlag(argv, '--limit') ?? 8);
  const categories = getAll(argv, '--category');
  const body = { query, limit, ...(categories.length ? { categories } : {}) };
  const results = await orgApi(config, 'POST', '/wiki/search', body);
  const trimmed = (results ?? []).map((r) => ({
    path: r.path,
    score: r.score,
    snippet: typeof r.content === 'string' ? r.content.slice(0, 600) : r.content,
  }));
  print({ query, categories: categories.length ? categories : undefined, results: trimmed }, config);
}
