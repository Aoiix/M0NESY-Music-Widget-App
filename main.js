const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");

const legacySongsFilePath = path.join(__dirname, "songs.json");
const legacySongsDirectory = path.join(__dirname, "songs");

let songsFilePath;
let songsDirectory;

let mainWindow;
let menuWindow;
let isMenuReady = false;
let shouldShowMenuWhenReady = false;
let songsDirectoryWatcher;
let songsDirectoryChangeTimer;
const MENU_WIDTH = 248;
const MENU_HEIGHT = 304;

function syncMenuPosition() {
  if (!mainWindow || !menuWindow || menuWindow.isDestroyed()) {
    return;
  }

  if (!menuWindow.isVisible()) {
    return;
  }

  const bounds = mainWindow.getBounds();
  menuWindow.setPosition(bounds.x + bounds.width + 10, bounds.y, false);
}

function lockMenuWindowBounds() {
  if (!menuWindow || menuWindow.isDestroyed()) {
    return;
  }

  menuWindow.setResizable(false);
  menuWindow.setMinimumSize(MENU_WIDTH, MENU_HEIGHT);
  menuWindow.setMaximumSize(MENU_WIDTH, MENU_HEIGHT);
  menuWindow.setContentSize(MENU_WIDTH, MENU_HEIGHT);
}

function showMenuWindow() {
  if (!mainWindow || !menuWindow || menuWindow.isDestroyed() || !isMenuReady) {
    return;
  }

  lockMenuWindowBounds();
  syncMenuPosition();

  if (!menuWindow.isVisible()) {
    menuWindow.show();
  }

  menuWindow.focus();
}

function sortSongs(songs) {
  return [...songs].sort((left, right) =>
    left.title.localeCompare(right.title, undefined, { sensitivity: "base" })
  );
}

function initializeSongsLibraryPaths() {
  if (songsFilePath && songsDirectory) {
    return;
  }

  const libraryDirectory = path.join(app.getPath("userData"), "library");
  songsFilePath = path.join(libraryDirectory, "songs.json");
  songsDirectory = path.join(libraryDirectory, "songs");

  fs.mkdirSync(libraryDirectory, { recursive: true });
  fs.mkdirSync(songsDirectory, { recursive: true });
}

function resolveSongFilePath(songFile) {
  if (typeof songFile !== "string" || !songFile.trim()) {
    return "";
  }

  return path.isAbsolute(songFile)
    ? path.resolve(songFile)
    : path.resolve(__dirname, songFile);
}

function isPathInsideDirectory(filePath, directoryPath) {
  const normalizedDirectoryPath = path.resolve(directoryPath) + path.sep;
  return path.resolve(filePath).startsWith(normalizedDirectoryPath);
}

function loadSongs() {
  initializeSongsLibraryPaths();

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
  initializeSongsLibraryPaths();
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

function getMp3DirectoryEntries(directoryPath) {
  if (!fileExists(directoryPath)) {
    return [];
  }

  return fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".mp3");
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
  initializeSongsLibraryPaths();
  const absoluteFilePath = resolveSongFilePath(songFile);
  return Boolean(absoluteFilePath) && isPathInsideDirectory(absoluteFilePath, songsDirectory) && fileExists(absoluteFilePath);
}

function getExistingSongsFromDirectory() {
  initializeSongsLibraryPaths();
  return getMp3DirectoryEntries(songsDirectory).map((entry) => toSongTitle(entry.name));
}

function getSongEntriesFromDirectory() {
  initializeSongsLibraryPaths();

  return getMp3DirectoryEntries(songsDirectory).map((entry) => ({
      title: toSongTitle(entry.name),
      file: path.join(songsDirectory, entry.name)
    }));
}

function reconcileSongsWithDirectory(storedSongs) {
  const songsFromDirectory = getSongEntriesFromDirectory();
  const availableFiles = new Set(songsFromDirectory.map((song) => path.resolve(song.file)));
  const validStoredSongs = Array.isArray(storedSongs)
    ? storedSongs.filter(
        (song) =>
          song &&
          typeof song.title === "string" &&
          typeof song.file === "string" &&
          availableFiles.has(path.resolve(song.file))
      )
    : [];
  const seenFiles = new Set(validStoredSongs.map((song) => path.resolve(song.file)));
  const reconciledSongs = [...validStoredSongs];

  for (const song of songsFromDirectory) {
    const normalizedFilePath = path.resolve(song.file);

    if (seenFiles.has(normalizedFilePath)) {
      continue;
    }

    reconciledSongs.push(song);
    seenFiles.add(normalizedFilePath);
  }

  return reconciledSongs;
}

function importSongs(filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return { songs: loadSongs(), addedSongs: [] };
  }

  initializeSongsLibraryPaths();
  fs.mkdirSync(songsDirectory, { recursive: true });

  const storedSongs = loadSongs();
  const existingSongs = getExistingSongsFromDirectory();
  const existingFiles = new Set(storedSongs.map((song) => path.resolve(song.file)));
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

    const normalizedDestinationPath = path.resolve(destinationPath);

    if (existingFiles.has(normalizedDestinationPath)) {
      continue;
    }

    const song = {
      title: toSongTitle(destinationName),
      file: normalizedDestinationPath
    };

    existingFiles.add(normalizedDestinationPath);
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

  initializeSongsLibraryPaths();
  const songs = loadSongs();
  const nextSongs = songs.filter((song) => song.file !== file);

  if (nextSongs.length === songs.length) {
    return { songs, removed: false };
  }

  const normalizedFilePath = resolveSongFilePath(file);

  if (normalizedFilePath && isPathInsideDirectory(normalizedFilePath, songsDirectory) && fileExists(normalizedFilePath)) {
    fs.unlinkSync(normalizedFilePath);
  }

  return { songs: saveSongs(nextSongs), removed: true };
}

function getLegacySongsFromDirectory() {
  return getMp3DirectoryEntries(legacySongsDirectory).map((entry) => path.join(legacySongsDirectory, entry.name));
}

function migrateLegacySongsLibrary() {
  initializeSongsLibraryPaths();

  const hasCurrentSongs = fileExists(songsFilePath) || getSongEntriesFromDirectory().length > 0;

  if (hasCurrentSongs) {
    return;
  }

  const legacySongFiles = getLegacySongsFromDirectory();

  if (!legacySongFiles.length && !fileExists(legacySongsFilePath)) {
    return;
  }

  importSongs(legacySongFiles);
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
  initializeSongsLibraryPaths();
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
    width: MENU_WIDTH,
    height: MENU_HEIGHT,
    x: mainBounds.x + mainBounds.width + 10,
    y: mainBounds.y,
    useContentSize: true,
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

  lockMenuWindowBounds();
  menuWindow.loadFile("menu.html");
  syncMenuPosition();

  menuWindow.on("will-resize", (event) => {
    event.preventDefault();
    lockMenuWindowBounds();
  });

  menuWindow.on("resize", () => {
    lockMenuWindowBounds();
    syncMenuPosition();
  });

  menuWindow.on("closed", () => {
    menuWindow = null;
    isMenuReady = false;
    shouldShowMenuWhenReady = false;
  });
}

ipcMain.on("open-menu", () => {
  shouldShowMenuWhenReady = true;
  createMenuWindow();

  if (!menuWindow || menuWindow.isDestroyed()) {
    return;
  }

  if (!isMenuReady) {
    return;
  }

  showMenuWindow();
});

ipcMain.on("play-song", (event, file) => {
  mainWindow.webContents.send("select-song", file);
});

ipcMain.on("menu-ready", () => {
  if (menuWindow && !menuWindow.isDestroyed()) {
    isMenuReady = true;

    if (shouldShowMenuWhenReady) {
      showMenuWindow();
    }
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
  initializeSongsLibraryPaths();
  migrateLegacySongsLibrary();
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
