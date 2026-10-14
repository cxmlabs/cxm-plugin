// Customer schema view over CubeJS /meta: every dataset except the ones the platform marks internal.
export function schemaView(cubes, name) {
  const field = (f) => ({ name: f.name, type: f.type, title: f.shortTitle || f.title, ...(f.description ? { description: f.description } : {}) });
  const visible = cubes.filter((c) => c.meta?.internal !== true);
  if (!name || name === true) {
    return { datasets: visible.map((c) => ({ dataset: c.name, measures: (c.measures || []).length, dimensions: (c.dimensions || []).length })) };
  }
  const needle = String(name).toLowerCase();
  const exact = visible.filter((c) => c.name.toLowerCase() === needle);
  const matches = exact.length ? exact : visible.filter((c) => c.name.toLowerCase().includes(needle));
  if (!matches.length) throw new Error(`No dataset matches "${name}". Run 'cxm analytics schema' to list them all.`);
  const out = matches.map((c) => ({ dataset: c.name, measures: (c.measures || []).map(field), dimensions: (c.dimensions || []).map(field), segments: (c.segments || []).map(field) }));
  return { schema: out.length === 1 ? out[0] : out };
}
