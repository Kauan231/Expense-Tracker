const { app, BrowserWindow, dialog, Notification  } = require("electron");
const { fork } = require("child_process");
const express = require("express");
const fs = require("fs");
const path = require("path");

const logDir = process.env.BACKEND_LOG_DIR ?? require("os").tmpdir();

const logFile = path.join(logDir, "backend.log");

function log(...args) {
  const msg =
    new Date().toISOString() + " " + args.map(a =>
      typeof a === "string" ? a : JSON.stringify(a)
    ).join(" ") + "\n";

  fs.appendFileSync(logFile, msg);

  if (!app.isPackaged) {
      console.log(msg);
  }
}

log("ELECTRON MAIN STARTED");

function notify(title, body) {
  log("[NOTIFY]", {title, body});

  if (!Notification.isSupported()) {
    log("Notifications not supported on this OS");
    return;
  }

  new Notification({
    title,
    body
  }).show();
}

const configPath = path.join(app.getPath("userData"), "config.json");

function loadConfig() {
  if (!fs.existsSync(configPath)) return {};
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

function saveConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

async function chooseUploadsDir() {
  const result = await dialog.showOpenDialog({
    title: "Choose where ExpenseTracker will store documents",
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const config = loadConfig();
  config.customUploadsDir = result.filePaths[0];
  saveConfig(config);

  return result.filePaths[0];
}

async function resolveUploadsPath() {
  const config = loadConfig();

  if (config.customUploadsDir && fs.existsSync(config.customUploadsDir)) {
    return path.join(config.customUploadsDir, "uploads");
  }

  const chosen = await chooseUploadsDir();
  if (chosen) return path.join(chosen, "uploads");

  return path.join(app.getPath("userData"), "uploads");
}

function startBackend(uploadsPath) {
  if (backendProcess) return;

  const backendEntry = app.isPackaged
    ? path.join(process.resourcesPath, "backend", "index.js")
    : path.join(__dirname, "../backend/index.js");

  if (!fs.existsSync(backendEntry)) {
    log("BACKEND ENTRY NOT FOUND:", backendEntry);
    return;
  }

  log("Starting backend with fork:", backendEntry);

  backendProcess = fork(backendEntry, [], {
    cwd: path.dirname(backendEntry),
    env: {
      ...process.env,
      UPLOADS_DIR: uploadsPath,
      BACKEND_LOG_DIR: path.dirname(backendEntry),
    },
    stdio: "pipe",
  });

  backendProcess.on("message", msg => {
    log("[BACKEND MESSAGE]", msg);
    if (msg?.type === "notify") {
      const { title, body } = msg.payload;
      notify(title, body);
    }
  });

  backendProcess.on("exit", (code, signal) => {
    log("BACKEND EXITED", { code, signal });
    backendProcess = null;
  });

  backendProcess.on("error", err => {
    log("BACKEND FORK ERROR:", err);
  });

  backendProcess.stdout?.on("data", d =>
    log("[BACKEND STDOUT]", d.toString())
  );

  backendProcess.stderr?.on("data", d =>
    log("[BACKEND STDERR]", d.toString())
  );
}

function waitForBackend(port, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const net = require("net");
    const start = Date.now();

    const check = () => {
      const socket = new net.Socket();

      socket
        .once("error", () => {
          socket.destroy();
          if (Date.now() - start > timeout) {
            reject(new Error("Backend did not become ready"));
          } else {
            setTimeout(check, 300);
          }
        })
        .connect(port, "127.0.0.1", () => {
          socket.end();
          resolve();
        });
    };

    check();
  });
}

function startFrontendServer() {
  if (frontendServer) return Promise.resolve(5174);

  return new Promise((resolve) => {
    const server = express();

    const distPath = path.join(
      __dirname,
      "../frontend/dist"
    );

    server.use(express.static(distPath));
    server.get(/.*/, (_, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });

    const PORT = 5174;

    frontendServer = server.listen(PORT, () => {
      log("Frontend running on port", PORT);
      resolve(PORT);
    });
  });
}

async function createWindow() {
  if (mainWindow) return;

  const uploadsPath = await resolveUploadsPath();
  fs.mkdirSync(uploadsPath, { recursive: true });

  log("UPLOADS_DIR =", uploadsPath);

  startBackend(uploadsPath);

  try {
    await waitForBackend(3000);
    log("Backend is ready");
  } catch (err) {
    log(err.message);
  }
  const frontendPort = await startFrontendServer();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await mainWindow.loadURL(`http://localhost:${frontendPort}`);

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
}

let mainWindow = null;
let backendProcess = null;
let frontendServer = null;

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
  return;
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(createWindow);

app.on("before-quit", () => {
  if (backendProcess) backendProcess.kill();
  if (frontendServer) frontendServer.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});