// Read the real peer from X-Forwarded-For, honouring only as many hops as we
// actually trust (caller-controlled otherwise). Anything we cannot pin to a
// trusted hop is null, so the caller fails closed instead of rate-limiting on
// an attacker-chosen key.
export function clientIpFromForwarded(
  header: string | undefined,
  trustedHops: number,
): string | null {
  if (!Number.isFinite(trustedHops) || trustedHops < 1) return null;
  if (!header) return null;
  const parts = header
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Fewer entries than hops means the request skipped a proxy we expected.
  if (parts.length < trustedHops) return null;
  const entry = parts[parts.length - Math.floor(trustedHops)];
  return entry === undefined ? null : normalizeAddress(entry);
}

// Strips the transport decoration a proxy may add, then validates. An entry
// that is not an address is rejected rather than used as a bucket key.
function normalizeAddress(entry: string): string | null {
  if (entry.startsWith("[")) {
    const end = entry.indexOf("]");
    if (end < 0) return null;
    const rest = entry.slice(end + 1);
    if (rest.length > 0 && !/^:\d{1,5}$/.test(rest)) return null;
    const inner = entry.slice(1, end);
    return isIPv6(inner) ? inner.toLowerCase() : null;
  }
  const colon = entry.indexOf(":");
  if (colon > 0 && colon === entry.lastIndexOf(":")) {
    const host = entry.slice(0, colon);
    if (isIPv4(host) && /^\d{1,5}$/.test(entry.slice(colon + 1))) return host;
  }
  if (isIPv4(entry)) return entry;
  return isIPv6(entry) ? entry.toLowerCase() : null;
}

function isIPv4(value: string): boolean {
  const octets = value.split(".");
  if (octets.length !== 4) return false;
  return octets.every((octet) => {
    if (!/^\d{1,3}$/.test(octet)) return false;
    // Leading zeros are a second spelling of one address, so a second bucket.
    if (octet.length > 1 && octet.startsWith("0")) return false;
    return Number(octet) <= 255;
  });
}

function isIPv6(value: string): boolean {
  const elision = value.indexOf("::");
  if (elision !== value.lastIndexOf("::")) return false;
  const head = elision < 0 ? value : value.slice(0, elision);
  const tail = elision < 0 ? "" : value.slice(elision + 2);
  const groups = [
    ...(head.length > 0 ? head.split(":") : []),
    ...(tail.length > 0 ? tail.split(":") : []),
  ];
  let width = groups.length;
  const last = groups[groups.length - 1];
  const hexGroups = last?.includes(".") ? groups.slice(0, -1) : groups;
  if (last?.includes(".")) {
    if (!isIPv4(last)) return false;
    width += 1; // a trailing IPv4 literal occupies two groups
  }
  if (!hexGroups.every((group) => /^[0-9a-fA-F]{1,4}$/.test(group))) {
    return false;
  }
  return elision < 0 ? width === 8 : width <= 7;
}
