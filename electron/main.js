const { app, BrowserWindow, dialog, Notification, ipcMain, shell } = require("electron");
const { fork } = require("child_process");
const fs = require("fs");
const path = require("path");
const express = require("express");
const os = require("os");

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
}

const BACKEND_PORT = 3000;
const BACKEND_HOST = getLocalIP();
const API_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}`;

const isPreview = process.argv.includes("--preview");
const isDev = process.argv.includes("--dev");
const isDebug = process.argv.includes("--debug");

if (process.platform === "win32") {
  app.setAppUserModelId("com.kauan.expensetracker");
}

ipcMain.handle("open-file", async (event, filePath) => {
  return shell.openPath(filePath);
});

const logFile = path.join(app.getPath("userData"), "main.log");
function log(...args) {
  const msg =
    new Date().toISOString() +
    " " +
    args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") +
    "\n";

  fs.appendFileSync(logFile, msg);

  if (!app.isPackaged) console.log(msg);
}

log("ELECTRON MAIN STARTED");

function notify(title, body) {
  if (!Notification.isSupported()) return;
  new Notification({ title, body }).show();
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

  if (result.canceled) return null;

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

let backendProcess = null;
function startBackend(uploadsPath) {
  if (backendProcess) return;

  const backendEntry = app.isPackaged
    ? path.join(process.resourcesPath, "backend", "index.js")
    : path.join(__dirname, "../backend/index.js");

  log("Starting backend:", backendEntry);

  backendProcess = fork(backendEntry, [], {
    env: {
      ...process.env,
      UPLOADS_DIR: uploadsPath,
      SQLITE_PATH: uploadsPath + "/Database/prod.sqlite3",
      DEV: isDev
    },
    stdio: "pipe",
  });

  backendProcess.on("message", msg => {
    if (msg?.type === "notify") {
      notify(msg.payload.title, msg.payload.body);
    }
  });

  backendProcess.stderr?.on("data", d => {
    log("[BACKEND STDERR]", d.toString());
  });
}

let frontendServer;
function startFrontendServer(apiUrl) {
  if (frontendServer) return Promise.resolve(5174);

  return new Promise((resolve) => {
    const server = express();
    const distPath = path.join(__dirname, "../frontend/dist");

    server.get("/config.js", (_, res) => {
      res.type("application/javascript");
      res.send(`window.__CONFIG__ = { API_URL: "${apiUrl}" };`);
    });

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

let mainWindow = null;

async function createWindow() {
  const uploadsPath = await resolveUploadsPath();
  fs.mkdirSync(uploadsPath, { recursive: true });

  log("UPLOADS PATH =", uploadsPath);

  startBackend(uploadsPath);

  const preloadPath = path.join(__dirname, "preload.js");
  log("PRELOAD PATH =", preloadPath);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });

  mainWindow.webContents.on("did-finish-load", () => {
    log("LOADED URL:", mainWindow.webContents.getURL());
  });

  const useBuiltFrontend = app.isPackaged || isPreview;
  if (!useBuiltFrontend) {
    log("DEV MODE → loading localhost:3000");
    await mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(
      __dirname,
      "../frontend/dist/index.html"
    );

    await mainWindow.loadFile(indexPath);
    if(isDev) {
      await startFrontendServer(API_URL);
    }

    if(isDebug) {
      mainWindow.webContents.openDevTools();
    }
  }
}

app.whenReady().then(createWindow);

app.on("before-quit", () => {
  if (backendProcess) backendProcess.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});