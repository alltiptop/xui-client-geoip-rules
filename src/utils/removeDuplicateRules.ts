import type { JsonOptions, XrayRule } from '../types.js';

export const removeDuplicateRules = (json: JsonOptions) => {
  const rules = (json.routing as JsonOptions)?.rules as unknown as XrayRule[];

  if (!rules) return json;

  const seenRules = new Set();
  const finalRules: XrayRule[] = [];

  for (const originalRule of rules) {
    const rule = JSON.parse(JSON.stringify(originalRule));

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