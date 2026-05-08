import type { JsonOptions, XrayRule } from '../types.js';

const normalizeRuleField = (value: unknown): string => {
  if (Array.isArray(value)) {
    return JSON.stringify([...value].sort());
  }

  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }

  return JSON.stringify(value ?? null);
};

export const removeDuplicateRules = (json: JsonOptions) => {
  const rules = (json.routing as JsonOptions)?.rules as unknown as XrayRule[];

  if (!rules) return json;

  const inbounds: Record<string, Set<string | number>> = {
    default: new Set(),
  };
  const finalRules: XrayRule[] = [];

  for (const originalRule of rules) {
    const rule = JSON.parse(JSON.stringify(originalRule));
    const dedupeKey = [
      ['inboundTag', rule.inboundTag],
      ['user', rule.user],
      ['port', rule.port],
      ['localPort', rule.localPort],
      ['vlessRoute', rule.vlessRoute],
      ['process', rule.process],
      ['localIP', rule.localIP],
      ['network', rule.network],
    ]
      .map(([key, value]) => `${key}:${normalizeRuleField(value)}`)
      .join('|');
    const seenRules = inbounds[dedupeKey] || (inbounds[dedupeKey] = new Set());

    const hadDomains = Array.isArray(rule.domain);
    const hadIps = Array.isArray(rule.ip);

    if (hadDomains) {
      rule.domain = rule.domain.filter((d: string | number) => {
        if (seenRules.has(d)) return false;
        seenRules.add(d);
        return true;
      });
    }

    if (hadIps) {
      rule.ip = rule.ip.filter((i: string | number) => {
        if (seenRules.has(i)) return false;
        seenRules.add(i);
        return true;
      });
    }

    const hasDomainsNow = hadDomains && rule.domain.length > 0;
    const hasIpsNow = hadIps && rule.ip.length > 0;

    // A rule object that originally had domain/ip rules is removed if both lists become empty.
    // A rule object that never had domain/ip rules is kept.
    if ((hadDomains || hadIps) && !hasDomainsNow && !hasIpsNow) {
      // This rule became empty, so we skip it.
      continue;
    }

    finalRules.push(rule);
  }

  return {
    ...json,
    routing: {
      ...(json.routing as JsonOptions),
      rules: finalRules,
    },
  };
};
