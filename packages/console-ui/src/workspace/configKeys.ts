/**
 * A cheap, stable structural key for a small string-map config value.
 *
 * The settings draft hooks only need to answer "did the server's map change since
 * the last render", but the previous `JSON.stringify(value)` serialised the whole
 * object on every render, and this component renders on each status poll. This
 * builds the same distinguishing string without the JSON machinery and without
 * allocating a parser's worth of intermediate strings. Keys are sorted so map
 * insertion order cannot make an unchanged document look new.
 */
export function stableObjectKey(value: Record<string, string[]> | undefined | null): string {
  if (!value) return "";
  const keys = Object.keys(value);
  if (keys.length === 0) return "";
  keys.sort();
  let key = "";
  for (const name of keys) {
    const list = value[name];
    key += name + "\u0001" + (Array.isArray(list) ? list.join(",") : "") + "\u0002";
  }
  return key;
}
