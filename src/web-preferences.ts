import type { WebPreferences } from 'electron';

export const PARTITION = 'persist:zenshape';

// Every Onshape view gets exactly these. No preload: Onshape gets zero bridge to Node.
export function onshapeWebPreferences(): WebPreferences {
  return {
    partition: PARTITION,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  };
}

// Our own strip page: same lockdown, plus the one preload we ship. It stays in
// the default session so it shares nothing with Onshape's cookies.
export function stripWebPreferences(preload: string): WebPreferences {
  return {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    preload,
  };
}
