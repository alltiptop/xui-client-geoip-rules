import countries from 'world-countries';

export const COUNTRY_TLDS = new Map<string, string[]>(
  countries.map((c) => [
    c.cca2.toUpperCase(),
    c.tld?.map((t) => t.replace(/^\./, '')) || [],
  ]),
);