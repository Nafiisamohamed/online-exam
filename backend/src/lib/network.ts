/**
 * Network address checks for exam rooms.
 *
 * Exams can be limited to the campus networks of their rooms (IPv4 CIDR such as
 * 192.168.10.0/24) or to single addresses. IPv4-mapped IPv6 (::ffff:1.2.3.4) is handled.
 */

/** Strips the IPv6 prefix Node adds to IPv4 addresses ("::ffff:10.0.0.5" -> "10.0.0.5"). */
export function normalizeIp(ip: string | undefined | null): string {
  if (!ip) return '';
  const trimmed = ip.trim();
  if (trimmed === '::1') return '127.0.0.1';
  return trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

/** True if `rule` is a valid IPv4 address or IPv4 CIDR. */
export function isValidNetworkRule(rule: string): boolean {
  const [addr, bits, extra] = rule.trim().split('/');
  if (extra !== undefined || ipv4ToInt(addr) === null) return false;
  if (bits === undefined) return true;
  return /^\d{1,2}$/.test(bits) && Number(bits) <= 32;
}

/** True if `ip` matches one rule ("10.0.0.5" exact or "10.0.0.0/24" range). */
export function ipMatches(ip: string, rule: string): boolean {
  const ipInt = ipv4ToInt(normalizeIp(ip));
  const [addr, bitsStr] = rule.trim().split('/');
  const ruleInt = ipv4ToInt(addr);
  if (ipInt === null || ruleInt === null) return false;
  const bits = bitsStr === undefined ? 32 : Number(bitsStr);
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return ((ipInt & mask) >>> 0) === ((ruleInt & mask) >>> 0);
}

/** True if the list is empty (no restriction) or any rule matches. */
export function ipAllowed(ip: string, rules: readonly string[]): boolean {
  if (rules.length === 0) return true;
  return rules.some((r) => ipMatches(ip, r));
}
