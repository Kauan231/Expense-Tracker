const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  openFile: (filePath) => ipcRenderer.invoke("open-file", filePath),
});
