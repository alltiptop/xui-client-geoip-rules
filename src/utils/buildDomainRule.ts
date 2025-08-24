import punycode from 'punycode';

import type { XrayRule } from '../types.js';

export const buildDomainRule = (tlds: string[]): XrayRule | null => {
  if (!tlds.length) return null;
  const rawDomains = tlds.map((domainSuffix) => punycode.toASCII(domainSuffix));
  const domains = rawDomains.map((domain) => `domain:${domain}`) || [];
  return { type: 'field', domain: domains, outboundTag: 'direct' };
}