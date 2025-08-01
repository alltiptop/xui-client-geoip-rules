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

const app = await createServer({
  upstreamUrl: process.env.UPSTREAM_URL!,     // URL of your 3x-ui instance
  secretUrl: process.env.SECRET_URL!,         // Secret path segment to hide the endpoint
  directSameCountry: true,                    // Direct same country as user by ip and domain
  rulesDir: 'rules',                          // Directory containing JSON rules
  logger: process.env.NODE_ENV !== 'production'
  xuiOptions: {                               // Opional settings for 3x-ui panel api
    panelAddress: process.env.XUI_PANEL_URL,  // 3x-ui panel address
    username: process.env.XUI_PANEL_LOGIN,    // 3x-ui login
    password: process.env.XUI_PANEL_PASSWORD, // 3x-ui password
    inboundIds: [process.env.XUI_INBOUND_ID], // inbounds list for users
    debug: process.env.NODE_ENV !== 'production',
  },
});

app.listen({ port: 3088, host: '0.0.0.0' });
```

---

## Rule Files

A template is available in the `rules-template/` directory. Rule files follow the native Xray routing format: <https://xtls.github.io/en/config/routing.html>

* **`base.json`** – applied first, before any country-specific rules.
* **`default.json`** – fallback rules when no matching country file is found.
* **`XX.json`** – any ISO-3166-1 alpha-2 country code, such as `de`, `nl`, `us`, etc.
* **`tags/<tag>/base.json`** – mandatory file, applied first for every visitor who activates this tag.
* **`tags/<tag>/default.json`** – fallback for the tag when there is no country-specific override.
* **`tags/<tag>/<ISO>.json`** – tag override for a particular country (ISO-3166-1 alpha-2).  Example: `tags/streaming/US.json`.

### Tag presets (optional)

Tags let you quickly switch additional rule-packs on/off without creating separate subscriptions.  A tag becomes **active** when it is present **either** in the request URL **or** in the user’s comment inside 3x-ui:

```text
GET /<secret>/json/<subId>?tags=gaming,streaming    ← query parameter (comma list or repeated key)

// 3x-ui › User › comment field
tags=gaming,streaming; another=data                  ← semicolon/new-line separated, case-insensitive
```

The backend merges both sources, removes duplicates, then processes every active tag in the order they were discovered.

Create a directory per tag under `rules/tags/`.  The directory **must** contain `base.json`, and **optionally** `default.json` plus any number of country overrides:

```text
rules
├ base.json        # Global baseline rules (applied first)
├ default.json     # Fallback when no country match
├ us.json          # Country preset (USA)
├ eu.json          # Regional preset (European Union)
└─ tags/
   └─ streaming/
      ├─ base.json      # always loaded first
      ├─ default.json   # used when visitor’s country has no override
      ├─ us.json        # overrides for United States
      └─ de.json        # overrides for Germany
```

File loading order **per tag** (case-insensitive file names):
1. `base.json` – always first.
2. `XX.json` – matching the visitor’s ISO-3166 country code (e.g. `us.json`).
3. `default.json` – only when a country file is **not** found.

This allows you to keep shared logic in **base** while adding country-specific tweaks only where necessary.

### Rule application order (updated)

1. **Direct rule** – Routes requests to `publicURL` directly to avoid geo-misdetection during self-updates.
2. **`base.json`** – Global baseline for everyone.
3. **Tag presets** – For every active tag: `base.json` → country override (or `default.json`).
4. **Same-country rules** – If `directSameCountry` is enabled, traffic destined to the client’s own country goes direct.
5. **Regional preset** – `eu.json` for EU visitors.
6. **Country preset** – Specific country file (e.g. `us.json`), or `default.json` when none exists.

---

## Why?

[3x-ui](https://github.com/MHSanaei/3x-ui) allows only one set of rules per subscription. This middleware automatically serves **different** rule sets based on the client’s IP country.