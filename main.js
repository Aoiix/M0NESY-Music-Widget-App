const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");

const songsFilePath = path.join(__dirname, "songs.json");
const songsDirectory = path.join(__dirname, "songs");

let mainWindow;
let menuWindow;
let isMenuReady = false;
let songsDirectoryWatcher;
let songsDirectoryChangeTimer;

function syncMenuPosition() {
  if (!mainWindow || !menuWindow || menuWindow.isDestroyed()) {
    return;
  }

  const bounds = mainWindow.getBounds();
  menuWindow.setPosition(bounds.x + bounds.width + 10, bounds.y, false);
}

function sortSongs(songs) {
  return [...songs].sort((left, right) =>
    left.title.localeCompare(right.title, undefined, { sensitivity: "base" })
  );
}

function loadSongs() {
  try {
    const fileContents = fs.readFileSync(songsFilePath, "utf8");
    const songs = JSON.parse(fileContents);

    if (!Array.isArray(songs)) {
      return [];
    }

    const sortedSongs = sortSongs(reconcileSongsWithDirectory(songs));

    if (!areSongsEqual(songs, sortedSongs)) {
      saveSongs(sortedSongs);
    }

    return sortedSongs;
  } catch (error) {
    return [];
  }
}

function saveSongs(songs) {
  const sortedSongs = sortSongs(songs);
  fs.writeFileSync(songsFilePath, JSON.stringify(sortedSongs, null, 2) + "\n", "utf8");
  return sortedSongs;
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch (error) {
    return false;
  }
}

function getUniqueSongPath(originalName) {
  const parsed = path.parse(originalName);
  const safeBaseName = parsed.name.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim() || "New Song";
  let candidateName = `${safeBaseName}${parsed.ext}`;
  let counter = 1;

  while (fileExists(path.join(songsDirectory, candidateName))) {
    candidateName = `${safeBaseName} (${counter})${parsed.ext}`;
    counter += 1;
  }

  return candidateName;
}

function toSongTitle(filename) {
  return path.parse(filename).name.trim();
}

function normalizeSongValue(value) {
  return String(value || "").trim().toLowerCase();
}

function areSongsEqual(leftSongs, rightSongs) {
  if (!Array.isArray(leftSongs) || !Array.isArray(rightSongs) || leftSongs.length !== rightSongs.length) {
    return false;
  }

  return leftSongs.every((song, index) => {
    const otherSong = rightSongs[index];
    return otherSong && song.title === otherSong.title && song.file === otherSong.file;
  });
}

function isSongFileAvailable(songFile) {
  if (typeof songFile !== "string") {
    return false;
  }

  const absoluteFilePath = path.resolve(__dirname, songFile);
  const normalizedSongsDirectory = path.resolve(songsDirectory) + path.sep;

  return absoluteFilePath.startsWith(normalizedSongsDirectory) && fileExists(absoluteFilePath);
}

function getExistingSongsFromDirectory() {
  if (!fileExists(songsDirectory)) {
    return [];
  }

  return fs
    .readdirSync(songsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".mp3")
    .map((entry) => toSongTitle(entry.name));
}

function getSongEntriesFromDirectory() {
  if (!fileExists(songsDirectory)) {
    return [];
  }

  return fs
    .readdirSync(songsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".mp3")
    .map((entry) => ({
      title: toSongTitle(entry.name),
      file: path.posix.join("songs", entry.name.replace(/\\/g, "/"))
    }));
}

function reconcileSongsWithDirectory(storedSongs) {
  const validStoredSongs = Array.isArray(storedSongs)
    ? storedSongs.filter(
        (song) =>
          song &&
          typeof song.title === "string" &&
          typeof song.file === "string" &&
          isSongFileAvailable(song.file)
      )
    : [];
  const songsFromDirectory = getSongEntriesFromDirectory();
  const seenFiles = new Set(validStoredSongs.map((song) => song.file));
  const reconciledSongs = [...validStoredSongs];

  for (const song of songsFromDirectory) {
    if (seenFiles.has(song.file)) {
      continue;
    }

    reconciledSongs.push(song);
    seenFiles.add(song.file);
  }

  return reconciledSongs;
}

function importSongs(filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return { songs: loadSongs(), addedSongs: [] };
  }

  fs.mkdirSync(songsDirectory, { recursive: true });

  const storedSongs = loadSongs();
  const existingSongs = getExistingSongsFromDirectory();
  const existingFiles = new Set(storedSongs.map((song) => song.file));
  const existingTitles = new Set(existingSongs.map((song) => normalizeSongValue(song)));
  const importedSourcePaths = new Set();
  const addedSongs = [];

  for (const filePath of filePaths) {
    if (typeof filePath !== "string" || path.extname(filePath).toLowerCase() !== ".mp3") {
      continue;
    }

    const normalizedSourcePath = path.resolve(filePath);
    const sourceTitle = toSongTitle(path.basename(filePath));
    const normalizedTitle = normalizeSongValue(sourceTitle);

    if (
      importedSourcePaths.has(normalizedSourcePath) ||
      existingTitles.has(normalizedTitle)
    ) {
      continue;
    }

    const destinationName = getUniqueSongPath(path.basename(filePath));
    const destinationPath = path.join(songsDirectory, destinationName);

    fs.copyFileSync(filePath, destinationPath);

    const relativeFile = path.posix.join("songs", destinationName.replace(/\\/g, "/"));

    if (existingFiles.has(relativeFile)) {
      continue;
    }

    const song = {
      title: toSongTitle(destinationName),
      file: relativeFile
    };

    existingFiles.add(relativeFile);
    existingTitles.add(normalizeSongValue(song.title));
    importedSourcePaths.add(normalizedSourcePath);
    addedSongs.push(song);
  }

  const songs = saveSongs([...storedSongs, ...addedSongs]);
  return { songs, addedSongs };
}

function removeSong(file) {
  if (typeof file !== "string") {
    return { songs: loadSongs(), removed: false };
  }

  const songs = loadSongs();
  const nextSongs = songs.filter((song) => song.file !== file);

  if (nextSongs.length === songs.length) {
    return { songs, removed: false };
  }

  const absoluteFilePath = path.join(__dirname, file);
  const normalizedSongsDirectory = path.resolve(songsDirectory) + path.sep;
  const normalizedFilePath = path.resolve(absoluteFilePath);

  if (normalizedFilePath.startsWith(normalizedSongsDirectory) && fileExists(normalizedFilePath)) {
    fs.unlinkSync(normalizedFilePath);
  }

  return { songs: saveSongs(nextSongs), removed: true };
}

function broadcastSongsUpdated(songs) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("songs-updated", songs);
  }

  if (menuWindow && !menuWindow.isDestroyed()) {
    menuWindow.webContents.send("songs-updated", songs);
  }
}

function syncSongsFromDirectoryChange() {
  clearTimeout(songsDirectoryChangeTimer);
  songsDirectoryChangeTimer = setTimeout(() => {
    broadcastSongsUpdated(loadSongs());
  }, 100);
}

function watchSongsDirectory() {
  fs.mkdirSync(songsDirectory, { recursive: true });

  if (songsDirectoryWatcher) {
    songsDirectoryWatcher.close();
  }

  songsDirectoryWatcher = fs.watch(songsDirectory, syncSongsFromDirectoryChange);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 320,
    height: 452,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile("index.html");
  createMenuWindow();

  mainWindow.on("move", syncMenuPosition);
  mainWindow.on("moved", syncMenuPosition);
}

function createMenuWindow() {
  if (menuWindow) {
    return;
  }

  const mainBounds = mainWindow.getBounds();

  menuWindow = new BrowserWindow({
    title: "",
    backgroundColor: "#00000000",
    width: 248,
    height: 304,
    x: mainBounds.x + mainBounds.width + 10,
    y: mainBounds.y,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    movable: false,
    frame: false,
    transparent: true,
    show: false,
    hasShadow: false,
    roundedCorners: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  menuWindow.loadFile("menu.html");
  syncMenuPosition();

  menuWindow.on("close", (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      menuWindow.hide();
    }
  });

  menuWindow.on("closed", () => {
    menuWindow = null;
    isMenuReady = false;
  });
}

ipcMain.on("open-menu", () => {
  createMenuWindow();

  if (!menuWindow || !isMenuReady) {
    return;
  }

  const bounds = mainWindow.getBounds();
  menuWindow.setPosition(bounds.x + bounds.width + 10, bounds.y, false);
  menuWindow.show();
  menuWindow.focus();
});

ipcMain.on("play-song", (event, file) => {
  mainWindow.webContents.send("select-song", file);
});

ipcMain.on("menu-ready", () => {
  if (menuWindow && !menuWindow.isDestroyed()) {
    isMenuReady = true;
  }
});

ipcMain.handle("get-songs", () => {
  return loadSongs();
});

ipcMain.handle("choose-songs", async () => {
  const response = await dialog.showOpenDialog({
    title: "Add Songs",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "MP3 Files", extensions: ["mp3"] }]
  });

  if (response.canceled || response.filePaths.length === 0) {
    return { songs: loadSongs(), addedSongs: [] };
  }

  const result = importSongs(response.filePaths);
  broadcastSongsUpdated(result.songs);
  return result;
});

ipcMain.handle("add-songs", (event, filePaths) => {
  const result = importSongs(filePaths);
  broadcastSongsUpdated(result.songs);
  return result;
});

ipcMain.handle("remove-song", (event, file) => {
  const result = removeSong(file);
  broadcastSongsUpdated(result.songs);
  return result;
});

app.whenReady().then(() => {
  watchSongsDirectory();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  app.isQuiting = true;
  clearTimeout(songsDirectoryChangeTimer);

  if (songsDirectoryWatcher) {
    songsDirectoryWatcher.close();
    songsDirectoryWatcher = null;
  }
});
