const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const projectRoot = __dirname;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const electronBinaryName = process.platform === "win32" ? "electron.cmd" : "electron";
const electronBinaryPath = path.join(projectRoot, "node_modules", ".bin", electronBinaryName);

function hasElectronInstalled() {
  return fs.existsSync(electronBinaryPath);
}

function installDependenciesIfNeeded() {
  if (hasElectronInstalled()) {
    return;
  }

  console.log("First launch detected. Installing dependencies...");

  const installResult = spawnSync(npmCommand, ["install"], {
    cwd: projectRoot,
    stdio: "inherit"
  });

  if (installResult.status !== 0) {
    process.exit(installResult.status || 1);
  }
}

function launchElectron() {
  if (!hasElectronInstalled()) {
    console.error("Electron is still missing after install. Please run `npm install` manually.");
    process.exit(1);
  }

  const electronProcess = spawn(electronBinaryPath, ["."], {
    cwd: projectRoot,
    stdio: "inherit"
  });

  electronProcess.on("exit", (code) => {
    process.exit(code || 0);
  });
}

installDependenciesIfNeeded();
launchElectron();
