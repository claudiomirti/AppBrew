# AppBrew — Mybrew CMO Command Center

A Microsoft Fabric real-time analytics demo for a fictional coffee brand, **Mybrew**.

A React SPA deployed as a [Rayfin](https://www.npmjs.com/package/@microsoft/rayfin-cli)
static app inside a Fabric workspace. It reads live event streams from a Fabric
Eventhouse, calls a Fabric data agent over MCP, and pulls competitor news from
Microsoft Web IQ.
<img width="3655" height="2012" alt="Screenshot 2026-07-31 145311" src="https://github.com/user-attachments/assets/dc7e8d78-26c1-4d0a-83f5-3c581a116b1c" />

Here you can find a link to a video, how the demo works. 
https://1drv.ms/v/c/f0ba595d02447106/IQArE7fF4IMORJrhaH6zycNxAUlFsc3kl9PMFyaksROhmwU?e=T88vZz

> **Demo project.** The data is simulated and the numbers are illustrative — see
> [Known issues](#known-issues) before showing any figure to an audience.

## Pages

| Page | What it does |
| --- | --- |
| **Campaign Overview** | Spend, revenue, ROAS and CTR by campaign and publisher. |
| **Geo Command** | Regional performance on a map. |
| **Budget Optimizer** | Interactive reallocation of spend across publishers. |
| **Personalization** | Trigger performance — cold weather, win-back, tier nudge. |
| **Stream Analytics** | Live KQL queries against the Fabric Eventhouse, with the KQL shown beside every metric. Falls back to a local simulator when no Eventhouse is reachable. |
| **Business Context** | The domain ontology plus a Fabric data agent, reached over MCP. |
| **WW IQ** | Competitor news via Microsoft Web IQ, scored by a local sentiment lexicon. |

## Architecture

```
Fabric notebooks  ──▶  Eventstream  ──▶  Eventhouse (KQL)
                                              │
                                              ▼
                         React SPA  ◀──  direct browser KQL query
                              │             (Entra token, MSAL)
                              ├──▶  Fabric data agent  (MCP)
                              └──▶  Microsoft Web IQ   (REST)
```

The deployed build queries Kusto **straight from the browser**: the Fabric Kusto
endpoint returns permissive CORS headers, so once the browser holds an Entra token
for the cluster no backend is needed. Local `npm run dev` instead proxies through
Vite using your Azure CLI login (`vite-kql-proxy.ts`), so no app registration is
required for local work.

## Getting started

```bash
cd frontend
npm install
cp .env.example .env.local   # then edit
npm run dev
```

`npm run dev` uses your `az login` credentials through the Vite proxy. If the
Eventhouse is unreachable the Stream Analytics page automatically switches to a
built-in simulator, so the UI still works offline.

### Configuration

All settings live in `frontend/.env.local` (gitignored — see `.env.example`):

| Variable | Purpose |
| --- | --- |
| `VITE_KUSTO_CLUSTER` / `VITE_KUSTO_DATABASE` | Eventhouse to query. |
| `VITE_ENTRA_CLIENT_ID` / `VITE_ENTRA_TENANT_ID` | SPA app registration, used by deployed builds only. |
| `VITE_ENTRA_LOGIN_HINT` | Optional — disambiguates silent SSO when several accounts are signed in. |
| `VITE_FABRIC_WORKSPACE_ID` / `VITE_FABRIC_AGENT_ID` | Fabric data agent behind the Business Context page. Both default to the demo workspace's ids. |
| `VITE_WEBIQ_KEY` | Microsoft Web IQ key for the WW IQ page. |

> **This is a static site with no backend.** Every `VITE_*` value is compiled into
> the JavaScript bundle and is readable by anyone who opens the deployed app. Use a
> throwaway Web IQ key and rotate it after any demo.

## Deploying

```bash
npx rayfin login
npx rayfin up          # builds, deploys, applies schema
npx rayfin up status
```

Bump `version` in `rayfin/rayfin.yml` first. If the static step fails with a 500,
the app can briefly serve 404 on every path; retry with
`npx rayfin up staticapp deploy` — a deployment lock takes about 15 minutes to
expire, so retry on a loop rather than giving up.

The redirect URI `/streams` and the popup target `/blank.html` must both be
registered on the Entra app registration, and the host must serve `index.html`
for deep links.

## Fabric side

Notebooks in the Fabric workspace generate the data:

- `02_CMO_Simulator` — batch campaign scenario used for the executive storyline.
- `03_RT_Streaming_Simulator` / `04_RT_Eventstream_Simulator` — emit live events
  into the Eventstream, which lands them in the Eventhouse. Run
  `04_RT_Eventstream_Simulator` before the demo or Stream Analytics has no live feed.

Every item definition in the workspace — notebooks, data agents, eventstreams,
lakehouses, the ontology, KQL dashboards, reports and semantic models — is exported
under [`fabric/`](fabric/README.md), which also lists the item IDs and explains how to
re-import them.

`docs/02_CMO_Simulator_Executive_Storyline.md` is a four-act narrative
(SEE → DECIDE → ACT → PROVE) for presenting the simulator to a C-level audience,
with a speaking script and anticipated questions. A `.docx` version sits beside it.

## Known issues

Documented in full in §7 of the storyline document:

- **Notebook `02_CMO_Simulator` numbers do not reconcile.** Cell 3 values a
  conversion at a cup price (£4.75) while reporting a CPA of £21.14, so its revenue
  figure is roughly 18× too low; cells 3 and 5 disagree on total spend
  (£4.8M vs £3.245M); the blended CPA is a hard-coded string. Cells 3 and 5 never
  touch the lakehouse.
- **These figures also disagree with the `Mybrew Campaign Analytics` semantic
  model**, which reports £5.77M spend and 3.51× ROAS against the notebook's
  £4.8M and 4.13×. Reconcile before showing both together.
- The cold-weather trigger is threshold-gated at `< 5 °C` and silently produces no
  output when London is warmer — a dead spot mid-demo.

## Layout

```
frontend/          React + Vite SPA
  src/pages/       one file per page
  src/lib/         Eventhouse, MSAL auth, Web IQ, sentiment, simulator
rayfin/            Rayfin app config (rayfin.yml)
docs/              executive storyline (md + docx)
fabric/            exported Fabric item definitions (notebooks, agents, models…)
```

## Licence

No licence is granted. Internal demo material.
