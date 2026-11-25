import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Onshape pages the UI suite visits. The ones in your own account come from
// ui-targets.local.json at the repo's root (docs/ui-tests.md), each
// overridable by an env var.
const LOCAL = path.resolve(import.meta.dirname, '../../ui-targets.local.json');

const EXAMPLE = `{
  "owned": "https://cad.onshape.com/documents?resourceType=resourceuserowner&nodeId=<your home folder id>",
  "otherFolder": "https://cad.onshape.com/documents?nodeId=<a folder id>&resourceType=folder",
  "document": "https://cad.onshape.com/documents/<did>/w/<wid>/e/<eid of a Part Studio>",
  "drawing": "https://cad.onshape.com/documents/<did>/w/<wid>/e/<eid of a drawing in it>",
  "team": "https://cad.onshape.com/documents/t/<team id>, or empty to skip"
}`;

const local: Record<string, string> = existsSync(LOCAL)
  ? JSON.parse(readFileSync(LOCAL, 'utf8'))
  : {};

function target(key: string, env: string): string {
  const url = process.env[env] ?? local[key];
  if (url === undefined) {
    throw new Error(
      `UI tests: no "${key}" page. Set ${env}, or create ${LOCAL} like this:\n${EXAMPLE}`,
    );
  }
  return url;
}

export const urls = {
  owned: target('owned', 'ZS_TEST_OWNED'),
  shared: 'https://cad.onshape.com/documents?nodeId=12&resourceType=filter',
  otherFilter: 'https://cad.onshape.com/documents?nodeId=2&resourceType=filter',
  // Another folder, for lock tests (a folder lock must not allow it).
  otherFolder: target('otherFolder', 'ZS_TEST_FOLDER'),
  document: target('document', 'ZS_TEST_DOC'),
  // A drawing in that document (zen's drawing gutters).
  drawing: target('drawing', 'ZS_TEST_DRAWING'),
  // Optional: a Teams page. Empty skips that check.
  team: process.env.ZS_TEST_TEAM ?? local.team ?? '',
};
