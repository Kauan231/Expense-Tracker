const { contextBridge, shell } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  openFile: (path) => shell.openPath(path),
});
