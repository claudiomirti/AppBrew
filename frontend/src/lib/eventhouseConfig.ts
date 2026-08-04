/**
 * Shared Eventhouse connection settings.
 *
 * These are safe to ship in a browser bundle: the cluster URI and database name are not
 * secrets, and the Entra client id identifies a public SPA registration (no client secret).
 * Access is still governed by the signed-in user's permissions on the KQL database.
 *
 * Override any of them with a `.env` / `.env.local` file at the frontend root.
 */
export const KUSTO_CLUSTER =
  import.meta.env.VITE_KUSTO_CLUSTER ?? 'https://trd-t1s1uap7p3xkuvdx9s.z8.kusto.fabric.microsoft.com'

export const KUSTO_DATABASE =
  import.meta.env.VITE_KUSTO_DATABASE ?? 'mybrew_eventhouse'

/** SPA app registration "AppBrew Stream Analytics" (delegated Azure Data Explorer access). */
export const ENTRA_CLIENT_ID =
  import.meta.env.VITE_ENTRA_CLIENT_ID ?? 'b757ec5c-072a-46c9-ba6d-bd10f851900f'

export const ENTRA_TENANT_ID =
  import.meta.env.VITE_ENTRA_TENANT_ID ?? 'a7bb15d9-42fd-41c6-9b42-97da7d95eeb3'

/** Kusto issues per-cluster audiences, so the scope is derived from the cluster URI. */
export const KUSTO_SCOPE = `${KUSTO_CLUSTER}/user_impersonation`

/**
 * Optional UPN used to disambiguate silent single sign-on when the browser holds sessions
 * for several accounts. Leave unset when only one account is signed in.
 */
export const LOGIN_HINT = import.meta.env.VITE_ENTRA_LOGIN_HINT ?? ''

/** Fabric workspace holding the ontology, Eventhouse and data agent. */
export const FABRIC_WORKSPACE_ID =
  import.meta.env.VITE_FABRIC_WORKSPACE_ID ?? '4bf66efa-94d7-4753-a5c4-70c79358bbd6'

/**
 * The "AgentBrew" data agent item, grounded on the "Mybrew Marketing Model"
 * semantic model.
 *
 * NOT "brewOnto" (add60256-8038-4e9c-8734-b6cbc0a9ca15), even though that one is
 * grounded on the ontology this page draws. The ontology data source carries no
 * relationship metadata, so that agent cannot join — it silently answers numeric
 * questions from single-table aggregates on dim_customer (reporting tier_points as
 * revenue) and then describes a join it never performed. The semantic model carries
 * explicit relationships and matches the lakehouse exactly.
 */
export const AGENT_ID =
  import.meta.env.VITE_FABRIC_AGENT_ID ?? 'a5bd2864-b165-4782-9119-ad9d57698f58'

/** Display name, so the UI names the item the user sees in the workspace. */
export const AGENT_NAME = 'AgentBrew'

/** Azure OpenAI Assistants-compatible base URL for the data agent. */
export const AGENT_BASE_URL =
  `https://api.fabric.microsoft.com/v1/workspaces/${FABRIC_WORKSPACE_ID}` +
  `/dataagents/${AGENT_ID}/aiassistant/openai`

/**
 * The Fabric REST API authenticates against the Power BI Service resource. Both scopes have
 * tenant-wide admin consent, so this token is issued silently once the user has signed in.
 */
export const FABRIC_SCOPES = [
  'https://api.fabric.microsoft.com/Item.Execute.All',
  'https://api.fabric.microsoft.com/Item.Read.All',
]
