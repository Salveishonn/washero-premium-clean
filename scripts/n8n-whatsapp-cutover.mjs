#!/usr/bin/env node
/**
 * Repoint Washero n8n HTTP nodes to production whatsapp-tools.
 * Does not touch Vuelto workflows.
 *
 * Requires N8N_API_KEY. Dry-run by default; pass --apply to write the workflows.
 *
 *   N8N_API_KEY=... node scripts/n8n-whatsapp-cutover.mjs
 *   N8N_API_KEY=... node scripts/n8n-whatsapp-cutover.mjs --apply
 */
const BASE = process.env.N8N_BASE_URL?.replace(/\/$/, "") || "https://n8n.flynnpedroa.engineer";
const KEY = process.env.N8N_API_KEY || "";
const APPLY = process.argv.includes("--apply");
const PROD = "https://domslcbxgqbylmciqrxt.supabase.co/functions/v1/whatsapp-tools";
const LEGACY_HOST = "apiwashero.flynnpedroa.engineer";
const INBOUND_AUTH = { id: "DHxWaDoMvPTw5sjQ", name: "Inbound Auth" };

const WASHERO_WORKFLOWS = {
  inbound: "NWK9Nqajvkt35Zso",
  outbound: "xLrRt4VrVGgFYwko",
};
const VUELTO_WORKFLOWS = {
  inbound: "3Y3isgG7UDW6IeD1",
  outbound: "Ou4OxoMhICKx1UMg",
};

if (!KEY) {
  console.error("N8N_API_KEY is required");
  process.exit(1);
}

async function n8n(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "X-N8N-API-KEY": KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${options.method || "GET"} ${path} -> ${res.status} ${text.slice(0, 800)}`);
  }
  return body;
}

function httpUrls(workflow) {
  return (workflow.nodes || [])
    .filter((n) => String(n.type || "").includes("httpRequest"))
    .map((n) => ({
      name: n.name,
      url: n.parameters?.url || "",
      credential: n.credentials?.httpHeaderAuth?.name || n.credentials?.httpHeaderAuth?.id || "",
    }));
}

function isLegacyToolsUrl(url) {
  return typeof url === "string" && url.includes(LEGACY_HOST) && url.includes("whatsapp-tools");
}

function patchWashero(workflow, { switchOutboundIngestCredential = false } = {}) {
  let urlChanges = 0;
  let credentialChanges = 0;
  for (const node of workflow.nodes || []) {
    if (!String(node.type || "").includes("httpRequest")) continue;
    if (isLegacyToolsUrl(node.parameters?.url)) {
      node.parameters.url = PROD;
      urlChanges += 1;
    }
    if (
      switchOutboundIngestCredential &&
      node.name === "Ingest Outbound Message" &&
      node.credentials?.httpHeaderAuth?.id !== INBOUND_AUTH.id
    ) {
      node.credentials = {
        ...(node.credentials || {}),
        httpHeaderAuth: { ...INBOUND_AUTH },
      };
      credentialChanges += 1;
    }
  }
  return { urlChanges, credentialChanges };
}

function workflowPutBody(workflow) {
  // n8n public API rejects read-only fields (meta, id, active, versionId, …).
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings ?? {},
    staticData: workflow.staticData ?? null,
    pinData: workflow.pinData ?? {},
    description: workflow.description ?? "",
  };
}

async function writeWorkflow(id, workflow) {
  const wasActive = !!workflow.active;
  // PUT-in-place keeps the webhook live. Fall back to deactivate/activate if needed.
  try {
    await n8n(`/api/v1/workflows/${id}`, {
      method: "PUT",
      body: JSON.stringify(workflowPutBody(workflow)),
    });
  } catch (err) {
    if (!wasActive) throw err;
    await n8n(`/api/v1/workflows/${id}/deactivate`, { method: "POST" });
    try {
      await n8n(`/api/v1/workflows/${id}`, {
        method: "PUT",
        body: JSON.stringify(workflowPutBody(workflow)),
      });
    } finally {
      await n8n(`/api/v1/workflows/${id}/activate`, { method: "POST" });
    }
  }
  const after = await n8n(`/api/v1/workflows/${id}`);
  if (wasActive && !after.active) {
    await n8n(`/api/v1/workflows/${id}/activate`, { method: "POST" });
  }
}

const inbound = await n8n(`/api/v1/workflows/${WASHERO_WORKFLOWS.inbound}`);
const outbound = await n8n(`/api/v1/workflows/${WASHERO_WORKFLOWS.outbound}`);
let vueltoInbound = null;
let vueltoOutbound = null;
try {
  vueltoInbound = await n8n(`/api/v1/workflows/${VUELTO_WORKFLOWS.inbound}`);
  vueltoOutbound = await n8n(`/api/v1/workflows/${VUELTO_WORKFLOWS.outbound}`);
} catch (err) {
  console.warn("Vuelto workflow fetch skipped:", String(err.message || err));
}

const report = {
  apply: APPLY,
  productionToolsUrl: PROD,
  before: {
    washero: { inbound: httpUrls(inbound), outbound: httpUrls(outbound) },
    vuelto: {
      inbound: vueltoInbound ? httpUrls(vueltoInbound) : null,
      outbound: vueltoOutbound ? httpUrls(vueltoOutbound) : null,
    },
  },
};

const inboundPatch = patchWashero(inbound);
const outboundPatch = patchWashero(outbound, { switchOutboundIngestCredential: true });
report.pendingChanges = { inbound: inboundPatch, outbound: outboundPatch };

if (APPLY) {
  if (inboundPatch.urlChanges || inboundPatch.credentialChanges) {
    await writeWorkflow(WASHERO_WORKFLOWS.inbound, inbound);
  }
  if (outboundPatch.urlChanges || outboundPatch.credentialChanges) {
    await writeWorkflow(WASHERO_WORKFLOWS.outbound, outbound);
  }
  const inboundAfter = await n8n(`/api/v1/workflows/${WASHERO_WORKFLOWS.inbound}`);
  const outboundAfter = await n8n(`/api/v1/workflows/${WASHERO_WORKFLOWS.outbound}`);
  const vueltoInAfter = await n8n(`/api/v1/workflows/${VUELTO_WORKFLOWS.inbound}`);
  const vueltoOutAfter = await n8n(`/api/v1/workflows/${VUELTO_WORKFLOWS.outbound}`);
  report.after = {
    washero: {
      inboundActive: inboundAfter.active,
      outboundActive: outboundAfter.active,
      inbound: httpUrls(inboundAfter),
      outbound: httpUrls(outboundAfter),
    },
    vuelto: {
      inboundActive: vueltoInAfter.active,
      outboundActive: vueltoOutAfter.active,
      inbound: httpUrls(vueltoInAfter),
      outbound: httpUrls(vueltoOutAfter),
    },
  };
  report.applied = true;
}

console.log(JSON.stringify(report, null, 2));
