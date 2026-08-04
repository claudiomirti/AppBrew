# Fabric workspace export

Item definitions exported from the **BrewP** Fabric workspace
(`4bf66efa-94d7-4753-a5c4-70c79358bbd6`, capacity `fabricmimi`, F64, West Europe).

Each folder is one item, laid out exactly as the Fabric
[getDefinition](https://learn.microsoft.com/rest/api/fabric/core/items/get-item-definition)
API returns it — one file per definition *part*, at the part's own path.

## Contents

| Type | Name | Item ID | Parts |
|---|---|---|---|
| DataAgent | AgentBrew | `a5bd2864-b165-4782-9119-ad9d57698f58` | 7 |
| DataAgent | brewOnto | `add60256-8038-4e9c-8734-b6cbc0a9ca15` | 9 |
| Eventstream | mybrew_eventstream | `ee4a7a81-9ffe-4e3a-9cb4-d4540c87ce65` | 3 |
| Eventstream | mybrew_rt_eventstream | `7faa3fb2-145c-49e6-ab59-fcdf6f4384ed` | 3 |
| GraphModel | MybrewOnto_graph_… | `35a1c247-4a35-49ad-9bd7-64428221c139` | 6 |
| KQLDashboard | Mybrew RTI Dashboard | `e9f336f9-0d6f-4b3f-9835-962358e48122` | 2 |
| KQLDashboard | NewRTD_brew | `a3e44e8a-90f5-440c-862f-f5e6d842695e` | 2 |
| KQLDatabase | mybrew_eventhouse | `d8446837-44f8-4c1a-bff6-474de9e54fcd` | 3 |
| Lakehouse | mybrew_lakehouse | `4084ce1f-b97f-4949-81a9-755f32d1f5df` | 4 |
| Lakehouse | MybrewOnto_lh_… | `fb245d8e-16e9-4e0b-9c7c-0021e1469af0` | 4 |
| Notebook | 01_Load_Demo_Data | `bbc5770a-cd3d-4cd3-8247-d098686e6071` | 2 |
| Notebook | 02_CMO_Simulator | `170ce58f-7ff9-40da-87f5-84d30316e925` | 2 |
| Notebook | 03_RT_Streaming_Simulator | `25a4fbc6-3cd5-472c-b284-9832ffc97d04` | 2 |
| Notebook | 04_RT_Eventstream_Simulator | `ba9296c9-4df8-4df7-b703-42adde05f26b` | 2 |
| Ontology | MybrewOnto | `6b19ceb0-32d4-411e-8221-cf2940fc07ca` | 30 |
| Report | BrewDash | `d15efa93-ead0-4fdf-9b28-3ea017878621` | 13 |
| SemanticModel | Mybrew Campaign Analytics | `dfd499af-2553-478d-896d-57de4ffa00bc` | 8 |
| SemanticModel | Mybrew Marketing Model | `ba620ccd-79c6-474e-902a-5fd423250fc8` | 14 |

### Not exported

`Eventhouse`, `SQLDatabase` and the three `SQLEndpoint` items have no definition API —
they are provisioned or derived automatically. The Eventhouse's schema is captured by the
`KQLDatabase/mybrew_eventhouse` export; the lakehouse SQL endpoints are derived from their
lakehouses. The `AppBackend/AppBrew` item is the Rayfin deployment target and is described
by `rayfin/rayfin.yml` in the repo root.

**Data is not included** — only definitions. Lakehouse tables are recreated by running
`Notebook/01_Load_Demo_Data`.

## Notebooks

Exported with `?format=ipynb`. **Execution outputs have been stripped** (`outputs: []`,
`execution_count: null`) so the files stay readable and diff cleanly — one plot in
`02_CMO_Simulator` alone was 3.6 MB of embedded base64 PNG. Cell *source* is untouched.

Run order for a cold workspace:

1. `01_Load_Demo_Data` — builds `mybrew_lakehouse` (dim_customer, dim_store, dim_weather,
   fact_transaction, fact_impression, campaign tables).
2. `02_CMO_Simulator` — the executive narrative. See
   [`../docs/02_CMO_Simulator_Executive_Storyline.md`](../docs/02_CMO_Simulator_Executive_Storyline.md)
   and the **Known issues** section of the root README before demoing this one.
3. `03_RT_Streaming_Simulator` — writes streaming signals straight to the Eventhouse.
4. `04_RT_Eventstream_Simulator` — same signals via `mybrew_rt_eventstream`. **Loops until
   stopped.** This is what feeds the app's Stream Analytics page; it must be running for
   that page to show live data.

## Re-importing

There is no single "import workspace" command. Per item, POST the parts back:

```
POST https://api.fabric.microsoft.com/v1/workspaces/{workspaceId}/items
{
  "displayName": "...",
  "type": "Notebook",
  "definition": {
    "format": "ipynb",
    "parts": [ { "path": "notebook-content.ipynb", "payload": "<base64>", "payloadType": "InlineBase64" } ]
  }
}
```

Use `items/{itemId}/updateDefinition` to overwrite an existing item instead. Omit `format`
for every type except Notebook (`ipynb`).

Definitions carry **absolute IDs** — lakehouse bindings, semantic model connection strings,
eventstream destinations. Re-importing into a different workspace requires rewriting those
GUIDs first. Notably:

- Notebooks pin `mybrew_lakehouse` = `4084ce1f-b97f-4949-81a9-755f32d1f5df`.
- `Report/BrewDash/definition.pbir` pins semantic model `dfd499af-…`.
- The ontology's bindings point at `mybrew_lakehouse`, **not** at `MybrewOnto_lh`
  (which is empty — see below).

## Known issues in these definitions

- **`brewOnto` returns wrong numbers.** Its ontology datasource part has `metadata: {}` —
  no relationship information — so it cannot join `fact_transaction` to `dim_customer` and
  silently falls back to single-table aggregates on `dim_customer` (it returns
  `SUM(tier_points)`, e.g. Gold 10,770, where the truth is £46.25). It then confabulates
  the join in its explanation. The app therefore uses **`AgentBrew`**, which is grounded on
  the semantic model and matches the lakehouse exactly.
- `MybrewOnto_lh` is an **empty** lakehouse — no entity tables were ever materialised.
- The ontology declares unbound placeholder properties on `fact_transaction`
  (`Total_Spend`, `Revenue`, `ROAS`, `Conversion_Rate`) with no `sourceColumn`.
- `02_CMO_Simulator` has several numeric inconsistencies — see the root README.

## Regenerating this export

The Fabric capacity must be **Active**, or every call returns
`404 CapacityNotActive`. `getDefinition` is a long-running operation: it answers `202` with
a `Location` header, which must be polled until `Succeeded` before `GET {location}/result`
returns the parts. Payloads are base64.
