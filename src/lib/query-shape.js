// The shape of an analytics query, for usage telemetry. Dataset names and counts only.
//
// It reads ONLY structural positions: measures, dimensions, segments, timeDimensions[].dimension,
// filters[].member (and nested and/or groups) and order keys. Never a filter value. A value such as
// "arn:aws:s3:::my.bucket" holds a dot, so a loose walk would record a customer resource id.
export function queryShape(query) {
  const heads = new Set();
  const add = (s) => {
    if (typeof s !== 'string') return;
    const dot = s.indexOf('.');
    if (dot > 0) heads.add(s.slice(0, dot));
  };
  const members = (filters) =>
    (filters ?? []).forEach((f) => {
      add(f?.member);
      members(f?.and);
      members(f?.or);
    });

  (query.measures ?? []).forEach(add);
  (query.dimensions ?? []).forEach(add);
  (query.segments ?? []).forEach(add);
  (query.timeDimensions ?? []).forEach((t) => add(t?.dimension));
  members(query.filters);
  if (Array.isArray(query.order)) query.order.forEach((pair) => add(Array.isArray(pair) ? pair[0] : pair));
  else Object.keys(query.order ?? {}).forEach(add);

  return {
    datasets: [...heads].sort(),
    measures: (query.measures ?? []).length,
    dimensions: (query.dimensions ?? []).length,
    segments: (query.segments ?? []).length,
    filters: (query.filters ?? []).length,
    time_dimensions: (query.timeDimensions ?? []).length,
    ordered: Boolean(query.order),
    limit: query.limit ?? null,
  };
}
