# Kairos integration package

Everything Kairos needs to integrate pmcopilot's research API into the existing Research / News / Outcomes / Holders panels.

## Files in this folder

| File | What it is |
|---|---|
| [`openapi.yaml`](./openapi.yaml) | OpenAPI 3.1 spec — feed into `openapi-typescript` / `openapi-generator` for client SDK codegen |
| [`INTEGRATION-GUIDE.md`](./INTEGRATION-GUIDE.md) | Quickstart, auth, endpoint mapping to Kairos panels, suggested 5-week rollout plan |
| [`README.md`](./README.md) | This file |

## TL;DR for Jay

11 endpoints, one auth header, JSON in/out. Slots into Kairos's existing panels without rebuilding the agent layer. Spec is locked at `1.0.0-rc1`; sandbox env live for integration testing.

## TL;DR for Zayd

1. Codegen client from `openapi.yaml`
2. Inject `X-Api-Key` header per env
3. Map endpoints to panels per the table in `INTEGRATION-GUIDE.md#mapping-to-kaiross-existing-panels`
4. Swap to `/research` (single call) on the market-detail page once individual endpoints are wired

## Server source

The `/v1/*` router lives at `apps/server/src/routes/kairos-v1.ts`. The auth middleware is `apps/server/src/middleware/kairosApiKey.ts`. Mount happens in `apps/server/src/index.ts` — search for `kairosV1Router`.

## To run locally

```bash
pnpm install
export KAIROS_API_KEYS="kairos_dev_localtest:dev"
pnpm --filter @pm-copilot/server dev
# Server: http://localhost:8787
# Probe:  curl http://localhost:8787/v1/health
# Auth:   curl http://localhost:8787/v1/markets/<id> -H "X-Api-Key: kairos_dev_localtest"
```

## Versioning

- URL prefix `/v1`. Breaking changes ship as `/v2` with 90 days of overlap.
- Additive changes (new optional fields, new endpoints) within `/v1` — clients must ignore unknown fields.
- Deprecations get a `Deprecation:` response header 30 days before sunset.

## Contact

AJ — `ayushya2002@gmail.com` · `@torque44` · Telegram. Response time ≤ 4h US-day hours.
