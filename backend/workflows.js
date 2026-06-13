// Server-side workflow registry — flat-file store, one JSON per workflow under
// data/workflows/. Mirrors the listings.js storage pattern (no DB at this
// scale). Phase 1 backing for the /api/workflows ingestion endpoint: it only
// stores and reads validated graphs — it does NOT execute anything.
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'data/workflows';
mkdirSync(DIR, { recursive: true });

const fileFor = (id) => join(DIR, `${id}.json`);
const safeId = (id) => /^[a-zA-Z0-9_-]+$/.test(id || '');

/** Persist a validated workflow. Assigns an id if missing; returns the stored record. */
export function saveWorkflow(workflow, { id } = {}) {
  const finalId = safeId(id) ? id : `wf-${Date.now().toString(36)}`;
  const record = { ...workflow, id: finalId, updatedAt: new Date().toISOString() };
  writeFileSync(fileFor(finalId), JSON.stringify(record, null, 2));
  return record;
}

export function getWorkflow(id) {
  if (!safeId(id) || !existsSync(fileFor(id))) return null;
  try {
    return JSON.parse(readFileSync(fileFor(id), 'utf8'));
  } catch {
    return null;
  }
}

/** List stored workflows as lightweight summaries (no node/edge bodies). */
export function listWorkflows() {
  let files = [];
  try {
    files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files
    .map((f) => {
      try {
        const w = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
        return {
          id: w.id,
          name: w.name,
          version: w.version,
          network: w.network,
          nodeCount: w.nodes?.length || 0,
          edgeCount: w.edges?.length || 0,
          updatedAt: w.updatedAt,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
