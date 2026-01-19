console.log("ELECTRON MAIN STARTED");

const { app, BrowserWindow } = require("electron");
const path = require("path");
const express = require("express");
const { spawn } = require("child_process");

let backendProcess;

function createWindow() {
  const uploadsPath = app.getPath('userData');

  // ─── Start backend ─────────────────────────────────────────────
  const backend = spawn("node", ["index.js"], {
    cwd: path.join(__dirname, "../Expense-Tracker-Backend"),
    shell: true,
    env: {
      ...process.env,
      UPLOADS_DIR: uploadsPath,
    },
  });

  backend.stdout.on("data", (data) => {
    console.log("[BACKEND STDOUT]", data.toString());
  });

  backend.stderr.on("data", (data) => {
    console.error("[BACKEND STDERR]", data.toString());
  });

  backend.on("exit", (code) => {
    console.log("[BACKEND EXIT]", code);
  });

  // ─── Serve frontend ────────────────────────────────────────────
  const server = express();

  const distPath = path.join(
    __dirname,
    "../Expense-Tracker-Frontend/dist"
  );

  server.use(express.static(distPath));

  server.get(/.*/, (_, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });

  const PORT = 5174;

  server.listen(PORT, () => {
    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    win.loadURL(`http://localhost:${PORT}`);
    win.webContents.openDevTools();
  });
}

// ─── Electron lifecycle ──────────────────────────────────────────
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (backendProcess) backendProcess.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (backendProcess) backendProcess.kill();
});
