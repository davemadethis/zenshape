// Renders assets/icon.svg to a transparent 1024px PNG using Electron itself
// (Quick Look thumbnails come out with opaque white corners).
// Usage: npx electron scripts/render-icon.cjs <out.png>
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '../assets/icon.svg'), 'utf8');
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.writeFileSync(process.argv.at(-1), image.resize({ width: 1024, height: 1024 }).toPNG());
  app.quit();
});
