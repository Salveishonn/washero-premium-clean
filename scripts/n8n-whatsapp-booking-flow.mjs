#!/usr/bin/env node
/**
 * Patch the live Washero inbound Flow Router + Normalize Inbound for the
 * full booking lifecycle (Places lock, MP/transfer/receipt, mis reservas).
 * Does not touch Vuelto workflows.
 *
 *   N8N_API_KEY=... node scripts/n8n-whatsapp-booking-flow.mjs
 *   N8N_API_KEY=... node scripts/n8n-whatsapp-booking-flow.mjs --apply
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.N8N_BASE_URL?.replace(/\/$/, "") || "https://n8n.flynnpedroa.engineer";
const KEY = process.env.N8N_API_KEY || "";
const APPLY = process.argv.includes("--apply");
const PROD = "https://domslcbxgqbylmciqrxt.supabase.co/functions/v1/whatsapp-tools";
const WASHERO_TOOLS_AUTH = { id: "l2vi2sGgGMJmUekW", name: "Washero whatsapp-tools" };
const GRAPH_PHONE_ID = "1128142377056954";
const GRAPH_CRED = { id: "oJjaASNtvna3by4y", name: "WASHERO WhatsApp API" };

const WASHERO_INBOUND = "NWK9Nqajvkt35Zso";
const VUELTO = { inbound: "3Y3isgG7UDW6IeD1", outbound: "Ou4OxoMhICKx1UMg" };

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FLOW_ROUTER_JS = readFileSync(join(root, "scripts/n8n-washero-flow-router.js"), "utf8");
const NORMALIZE_JS = readFileSync(join(root, "scripts/n8n-washero-normalize-inbound.js"), "utf8");

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

function workflowPutBody(workflow) {
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
  return after;
}

function httpUrls(workflow) {
  return (workflow.nodes || [])
    .filter((n) => String(n.type || "").includes("httpRequest"))
    .map((n) => ({
      name: n.name,
      url: n.parameters?.url || "",
      credentialId: n.credentials?.httpHeaderAuth?.id || n.credentials?.whatsAppApi?.id || "",
    }));
}

function patchInbound(workflow) {
  const changes = [];
  for (const node of workflow.nodes || []) {
    if (node.name === "Flow Router" && String(node.type || "").includes("code")) {
      if (node.parameters?.jsCode !== FLOW_ROUTER_JS) {
        node.parameters = { ...(node.parameters || {}), jsCode: FLOW_ROUTER_JS, language: "javaScript", mode: "runOnceForAllItems" };
        changes.push("Flow Router jsCode");
      }
    }
    if (node.name === "Normalize Inbound" && String(node.type || "").includes("code")) {
      if (node.parameters?.jsCode !== NORMALIZE_JS) {
        node.parameters = { ...(node.parameters || {}), jsCode: NORMALIZE_JS, language: "javaScript", mode: "runOnceForAllItems" };
        changes.push("Normalize Inbound jsCode");
      }
    }
    if (String(node.type || "").includes("httpRequest") && typeof node.parameters?.url === "string") {
      if (node.parameters.url.includes("whatsapp-tools") && node.parameters.url !== PROD) {
        node.parameters.url = PROD;
        changes.push(`${node.name} tools url`);
      }
      if (node.parameters.url.includes("whatsapp-tools")) {
        const credId = node.credentials?.httpHeaderAuth?.id;
        if (credId !== WASHERO_TOOLS_AUTH.id) {
          node.credentials = { ...(node.credentials || {}), httpHeaderAuth: { ...WASHERO_TOOLS_AUTH } };
          changes.push(`${node.name} tools credential`);
        }
      }
      if (node.parameters.url.includes("graph.facebook.com") && node.name === "Send WhatsApp Message") {
        if (!node.parameters.url.includes(GRAPH_PHONE_ID)) {
          throw new Error(`Refusing to change Graph send URL away from ${GRAPH_PHONE_ID}: ${node.parameters.url}`);
        }
        const gid = node.credentials?.whatsAppApi?.id;
        if (gid && gid !== GRAPH_CRED.id) {
          throw new Error(`Refusing to change Graph credential ${gid}`);
        }
      }
    }
  }
  return changes;
}

const inbound = await n8n(`/api/v1/workflows/${WASHERO_INBOUND}`);
const vueltoIn = await n8n(`/api/v1/workflows/${VUELTO.inbound}`);
const vueltoOut = await n8n(`/api/v1/workflows/${VUELTO.outbound}`);
const vueltoBefore = { inbound: httpUrls(vueltoIn), outbound: httpUrls(vueltoOut) };

const pending = patchInbound(inbound);
const report = {
  apply: APPLY,
  workflow: { id: inbound.id, name: inbound.name, active: inbound.active },
  pendingChanges: pending,
  flowRouterChars: FLOW_ROUTER_JS.length,
  normalizeChars: NORMALIZE_JS.length,
  vueltoBefore,
};

if (APPLY) {
  const after = await writeWorkflow(WASHERO_INBOUND, inbound);
  const vueltoInAfter = await n8n(`/api/v1/workflows/${VUELTO.inbound}`);
  const vueltoOutAfter = await n8n(`/api/v1/workflows/${VUELTO.outbound}`);
  report.after = {
    inboundActive: after.active,
    flowRouterUpdated: (after.nodes || []).some((n) => n.name === "Flow Router" && n.parameters?.jsCode?.includes("suggest_addresses")),
    normalizeUpdated: (after.nodes || []).some((n) => n.name === "Normalize Inbound" && n.parameters?.jsCode?.includes("mime_type")),
    graphSend: httpUrls(after).filter((u) => u.url.includes("graph.facebook.com")),
    tools: httpUrls(after).filter((u) => u.url.includes("whatsapp-tools")),
    vuelto: { inbound: httpUrls(vueltoInAfter), outbound: httpUrls(vueltoOutAfter) },
  };
  const vueltoChanged =
    JSON.stringify(httpUrls(vueltoInAfter)) !== JSON.stringify(vueltoBefore.inbound) ||
    JSON.stringify(httpUrls(vueltoOutAfter)) !== JSON.stringify(vueltoBefore.outbound);
  if (vueltoChanged) {
    throw new Error("Vuelto HTTP URLs changed after Washero PUT — aborting");
  }
  report.applied = true;
}

console.log(JSON.stringify(report, null, 2));
