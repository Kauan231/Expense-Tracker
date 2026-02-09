const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  openFile: (filePath) => ipcRenderer.invoke("open-file", filePath),
  apiUrl: () => global.__APP_CONFIG__?.API_URL
});
