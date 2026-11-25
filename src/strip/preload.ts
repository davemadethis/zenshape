import { contextBridge, ipcRenderer } from 'electron';
import {
  STRIP_COMMAND_CHANNEL,
  STRIP_STATE_CHANNEL,
  type StripState,
  type ZenshapeBridge,
} from '../strip-api';

// The only bridge in the app, and only our strip page gets it.
const bridge: ZenshapeBridge = {
  onState: (cb) =>
    ipcRenderer.on(STRIP_STATE_CHANNEL, (_event, state: StripState) =>
      cb(state),
    ),
  send: (cmd) => ipcRenderer.send(STRIP_COMMAND_CHANNEL, cmd),
};

contextBridge.exposeInMainWorld('zenshape', bridge);
