# 3x-ui Country-Based Rules Middleware

This service fetches a JSON subscription from [3x-ui](https://github.com/MHSanaei/3x-ui) and merges it with country-specific routing rules stored in the `rules/` directory.

Examples:
* `rules/nl.json` is applied for clients detected in the **Netherlands**
* `rules/de.json` for **Germany**
* `rules/default.json` when no country-specific file exists

---

## Installation

*npm*

```bash
npm i @alltiptop/geoip-3xui-rules
```

---

## Usage

```typescript
import { createServer } from 'xui-json-client-rules';
import dotenv from 'dotenv';

dotenv.config();

const app = createServer({
  upstreamUrl: process.env.UPSTREAM_URL!,   // URL of your 3x-ui instance
  secretUrl: process.env.SECRET_URL!,       // Secret path segment to hide the endpoint
  directSameCountry: true,                  // Direct same country as user by ip and domain
  rulesDir: 'rules',                        // Directory containing JSON rules
  logger: process.env.NODE_ENV !== 'production'
});

app.listen({ port: 3088, host: '0.0.0.0' });
```

---

## Rule Files

A template is available in the `rules-template/` directory. Rule files follow the native Xray routing format: <https://xtls.github.io/en/config/routing.html>

* **`base.json`** – applied first, before any country-specific rules.
* **`default.json`** – fallback rules when no matching country file is found.
* **`XX.json`** – any ISO-3166-1 alpha-2 country code, such as `de`, `nl`, `us`, etc.
* **`tags/<tag>.json`** – optional tag-specific presets. They are applied when the client adds `?tags=<tag>` to the URL. Multiple tags can be passed either as `?tags=tag1&tags=tag2` or as a comma list `?tags=tag1,tag2`.

### Tag presets (optional)

Need another layer of customization besides country-based rules?  Create a sub-folder `rules/tags/` and drop JSON files there — one file per tag. The file name (without extension) becomes the tag keyword.

For instance, `rules/tags/google.json` will be merged into the response whenever the request URL contains `?tags=google`.  You can specify several tags at once:

#### Query param:

```text
.../json/<id>?tags=google,office
```

#### 3X-UI user comment:

```text
comment: "tags=google,office;"
```

> Separator is ";" or new line

Tags are resolved **before** the country-specific rules, so you can still override them later if required.

Example directory layout:

```text
rules
├ base.json        # Global baseline rules (applied first)
├ default.json     # Fallback when no country match
├ gb.json          # Country preset (United Kingdom)
├ eu.json          # Regional preset (European Union)
└ tags/
   ├ google.json   # Applies with ?tags=google
   └ office.json   # Applies with ?tags=office
```

### Rule application order

The resulting `routing.rules` array is assembled in the sequence below (earlier entries have higher priority):

1. **Direct rule** – Routes requests to `publicURL` directly to avoid geo-misdetection during self-updates.
2. **`base.json`** – Global baseline that applies to everyone.
3. **Tag presets** – All matching files from `rules/tags/*` requested via the `?tags=` query parameter.
4. **Same-country rules** – If `directSameCountry` is enabled, traffic destined to the client’s own country goes direct.
5. **`eu.json`** – Regional rules for clients located in the European Union.
6. **Country preset** – The specific ISO-3166 country file (e.g. `us.json`, `de.json`), or `default.json` when none exists.

---

## Why?

[3x-ui](https://github.com/MHSanaei/3x-ui) allows only one set of rules per subscription. This middleware automatically serves **different** rule sets based on the client’s IP country.