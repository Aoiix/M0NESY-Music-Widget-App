const { ipcRenderer, webUtils } = require("electron");

const menuAssets = [
  "assets/menubg.svg",
  "assets/Menu Buttons.png",
  "assets/closebutton.svg",
  "assets/SongDeleteButton.svg",
  "assets/ScrollbarButton.svg"
];

const list = document.getElementById("song-list");
const addSongsButton = document.getElementById("add-songs-button");
const statusMessage = document.getElementById("menu-status");
const searchInput = document.getElementById("song-search");
const menuDisplay = document.getElementById("MenuDisplay");
const scrollbar = document.getElementById("menu-scrollbar");
const scrollbarTrack = document.getElementById("menu-scrollbar-track");
const scrollbarThumb = document.getElementById("menu-scrollbar-thumb");

let allSongs = [];
let isDraggingScrollbar = false;
let dragOffsetY = 0;
let scrollbarSyncFrame = null;
let songSearchFrame = null;
const textFitCache = new Map();

function setStatus(message) {
  if (!statusMessage) {
    return;
  }

  statusMessage.textContent = message;
  statusMessage.classList.toggle("has-text", Boolean(message));
}

function fitTextToWidth(element, maxFontSize, minFontSize) {
  const availableWidth = element.clientWidth;
  const cacheKey = [
    element.textContent,
    availableWidth,
    maxFontSize,
    minFontSize
  ].join("|");
  const cachedFontSize = textFitCache.get(cacheKey);

  if (cachedFontSize) {
    element.style.fontSize = cachedFontSize + "px";
    return;
  }

  let low = minFontSize;
  let high = maxFontSize;
  let bestFit = minFontSize;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    element.style.fontSize = mid + "px";

    if (element.scrollWidth <= availableWidth) {
      bestFit = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  element.style.fontSize = bestFit + "px";
  textFitCache.set(cacheKey, bestFit);
}

function scheduleScrollbarSync() {
  if (scrollbarSyncFrame !== null) {
    return;
  }

  scrollbarSyncFrame = requestAnimationFrame(() => {
    scrollbarSyncFrame = null;
    syncScrollbar();
  });
}

function getFilteredSongs() {
  const query = searchInput.value.trim().toLowerCase();

  if (!query) {
    return allSongs;
  }

  return allSongs.filter((song) => song.title.toLowerCase().includes(query));
}

function syncScrollbar() {
  const trackHeight = scrollbarTrack.clientHeight;
  const scrollHeight = menuDisplay.scrollHeight;
  const clientHeight = menuDisplay.clientHeight;
  const maxScrollTop = Math.max(scrollHeight - clientHeight, 0);

  if (!trackHeight) {
    return;
  }

  if (maxScrollTop <= 0) {
    scrollbarThumb.style.height = Math.min(trackHeight, 70) + "px";
    scrollbarThumb.style.top = "0px";
    scrollbar.style.opacity = "1";
    return;
  }

  const thumbHeight = Math.min(Math.max((clientHeight / scrollHeight) * trackHeight, 70), trackHeight);
  const scrollRatio = maxScrollTop ? menuDisplay.scrollTop / maxScrollTop : 0;
  const availableTrack = Math.max(trackHeight - thumbHeight, 0);
  const thumbOffset = Math.round(availableTrack * scrollRatio);

  scrollbarThumb.style.height = thumbHeight + "px";
  scrollbarThumb.style.top = thumbOffset + "px";
  scrollbar.style.opacity = "1";
}

function scrollFromThumbPosition(pointerY) {
  const trackRect = scrollbarTrack.getBoundingClientRect();
  const thumbHeight = scrollbarThumb.offsetHeight;
  const maxThumbTop = Math.max(trackRect.height - thumbHeight, 0);
  const nextTop = Math.min(Math.max(pointerY - trackRect.top - dragOffsetY, 0), maxThumbTop);
  const maxScrollTop = Math.max(menuDisplay.scrollHeight - menuDisplay.clientHeight, 0);
  const ratio = maxThumbTop ? nextTop / maxThumbTop : 0;

  menuDisplay.scrollTop = ratio * maxScrollTop;
}

async function handleRemoveSong(song) {
  const confirmed = window.confirm('Remove "' + song.title + '" from the song list?');

  if (!confirmed) {
    setStatus("");
    return;
  }

  setStatus("Removing " + song.title + "...");

  const result = await ipcRenderer.invoke("remove-song", song.file);
  allSongs = result.songs;
  renderSongs();

  if (result.removed) {
    setStatus("Removed " + song.title + ".");
  } else {
    setStatus("Song could not be removed.");
  }
}

function renderSongs() {
  const songs = getFilteredSongs();
  const fragment = document.createDocumentFragment();
  list.textContent = "";

  songs.forEach((song, index) => {
    const li = document.createElement("li");
    const row = document.createElement("div");
    const button = document.createElement("button");
    const removeButton = document.createElement("button");

    row.className = "song-row";
    button.className = "song-button";
    button.textContent = index + 1 + ". " + song.title;
    button.addEventListener("click", () => {
      ipcRenderer.send("play-song", song.file);
    });
    removeButton.className = "remove-song-button";
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", "Remove " + song.title);
    removeButton.title = "Remove " + song.title;
    removeButton.addEventListener("click", () => {
      handleRemoveSong(song);
    });

    row.appendChild(button);
    row.appendChild(removeButton);
    li.appendChild(row);
    fragment.appendChild(li);
    fitTextToWidth(button, 14, 9);
  });

  list.appendChild(fragment);

  if (!songs.length) {
    setStatus(allSongs.length ? "No songs match your search." : "Drag MP3 files into the menu or use Add.");
  }

  scheduleScrollbarSync();
}

async function refreshSongs() {
  allSongs = await ipcRenderer.invoke("get-songs");
  renderSongs();
}

function getDroppedMp3Paths(event) {
  return Array.from(event.dataTransfer.files)
    .map((file) => ({
      name: file.name,
      path: webUtils.getPathForFile(file)
    }))
    .filter((file) => file.path && file.name.toLowerCase().endsWith(".mp3"))
    .map((file) => file.path);
}

async function importSongs(filePaths) {
  if (!filePaths.length) {
    setStatus("Only MP3 files can be added.");
    return;
  }

  setStatus("Adding songs...");

  const result = await ipcRenderer.invoke("add-songs", filePaths);
  allSongs = result.songs;
  renderSongs();

  if (result.addedSongs.length) {
    const label = result.addedSongs.length === 1 ? "song" : "songs";
    setStatus("Added " + result.addedSongs.length + " " + label + ".");
  } else {
    setStatus("No new MP3 files were added.");
  }
}

addSongsButton.addEventListener("click", async () => {
  const result = await ipcRenderer.invoke("choose-songs");
  allSongs = result.songs;
  renderSongs();

  if (result.addedSongs.length) {
    const label = result.addedSongs.length === 1 ? "song" : "songs";
    setStatus("Added " + result.addedSongs.length + " " + label + ".");
  } else {
    setStatus("");
  }
});

["dragenter", "dragover"].forEach((eventName) => {
  window.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    setStatus("Drop MP3 files to add them to the shuffle.");
    document.body.classList.add("drag-active");
  });
});

["dragleave", "dragend"].forEach((eventName) => {
  window.addEventListener(eventName, (event) => {
    event.preventDefault();

    if (!event.relatedTarget || !document.body.contains(event.relatedTarget)) {
      document.body.classList.remove("drag-active");
    }
  });
});

window.addEventListener("drop", async (event) => {
  event.preventDefault();
  document.body.classList.remove("drag-active");
  await importSongs(getDroppedMp3Paths(event));
});

searchInput.addEventListener("input", () => {
  if (songSearchFrame !== null) {
    cancelAnimationFrame(songSearchFrame);
  }

  songSearchFrame = requestAnimationFrame(() => {
    songSearchFrame = null;
    renderSongs();
  });
});

menuDisplay.addEventListener("scroll", scheduleScrollbarSync, { passive: true });
window.addEventListener("resize", scheduleScrollbarSync);

scrollbarThumb.addEventListener("mousedown", (event) => {
  isDraggingScrollbar = true;
  dragOffsetY = event.clientY - scrollbarThumb.getBoundingClientRect().top;
  document.body.classList.add("dragging-scrollbar");
  event.preventDefault();
});

window.addEventListener("mousemove", (event) => {
  if (!isDraggingScrollbar) {
    return;
  }

  scrollFromThumbPosition(event.clientY);
});

window.addEventListener("mouseup", () => {
  isDraggingScrollbar = false;
  document.body.classList.remove("dragging-scrollbar");
});

scrollbarTrack.addEventListener("mousedown", (event) => {
  if (event.target === scrollbarThumb) {
    return;
  }

  dragOffsetY = scrollbarThumb.offsetHeight / 2;
  scrollFromThumbPosition(event.clientY);
});

document.getElementById("close-menu").addEventListener("click", () => {
  window.close();
});

ipcRenderer.on("songs-updated", (event, songs) => {
  allSongs = songs;
  renderSongs();
});

function preloadImage(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = resolve;
    image.onerror = resolve;
    image.src = src;
  });
}

async function revealMenuWhenReady() {
  await Promise.all(menuAssets.map(preloadImage));

  if (document.fonts && document.fonts.ready) {
    try {
      await document.fonts.ready;
    } catch (error) {
      // Ignore font readiness issues and still reveal the menu.
    }
  }

  await refreshSongs();

  document.body.classList.remove("menu-loading");
  document.body.classList.add("menu-ready");
  scheduleScrollbarSync();
  ipcRenderer.send("menu-ready");
}

window.addEventListener("load", () => {
  revealMenuWhenReady();
});

window.addEventListener("beforeunload", () => {
  if (scrollbarSyncFrame !== null) {
    cancelAnimationFrame(scrollbarSyncFrame);
  }

  if (songSearchFrame !== null) {
    cancelAnimationFrame(songSearchFrame);
  }
});
