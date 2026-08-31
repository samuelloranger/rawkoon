// Read the real peer from X-Forwarded-For, honouring only as many hops as we
// actually trust (caller-controlled otherwise).
export function clientIpFromForwarded(header: string | undefined, trustedHops: number): string {
  if (!header) return "unknown";
  const parts = header.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return "unknown";
  const idx = Math.max(0, parts.length - trustedHops);
  return parts[idx] ?? parts[parts.length - 1] ?? "unknown";
}
