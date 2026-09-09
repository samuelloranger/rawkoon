// Mutable state shared across the phased sweep: seeded/created ids and the two
// session cookies. `get` throws on a missing key so a fixture referencing an
// unseeded id fails loudly instead of putting `undefined` into a URL.
export interface Context {
  ids: Record<string, string>;
  cookies: { admin: string; user: string };
  set(k: string, v: string): void;
  get(k: string): string;
}

export function createContext(): Context {
  const ids: Record<string, string> = {};
  return {
    ids,
    cookies: { admin: "", user: "" },
    set(k, v) {
      ids[k] = v;
    },
    get(k) {
      const v = ids[k];
      if (v === undefined) throw new Error(`e2e context missing id "${k}"`);
      return v;
    },
  };
}
