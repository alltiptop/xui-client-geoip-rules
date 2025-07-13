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

Example:

```
rules
| base.json       # Before all rules
| default.json    # Default rule if country not specified
| gb.json         # Specific country rules
| eu.json         # Also, it supports EU region
```

---

## Why?

[3x-ui](https://github.com/MHSanaei/3x-ui) allows only one set of rules per subscription. This middleware automatically serves **different** rule sets based on the client’s IP country.