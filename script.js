const isElectronRuntime = typeof window !== "undefined" && typeof window.require === "function";
const electronApi = isElectronRuntime ? window.require("electron") : null;
const ipcRenderer = electronApi ? electronApi.ipcRenderer : null;
const fs = isElectronRuntime ? window.require("fs") : null;
const path = isElectronRuntime ? window.require("path") : null;
const pathToFileURL = isElectronRuntime ? window.require("url").pathToFileURL : null;

function pickExistingAssetPath(candidates) {
    if (!Array.isArray(candidates) || !candidates.length) {
        return "";
    }

    if (!isElectronRuntime || !fs || !path) {
        return candidates[0];
    }

    for (const candidate of candidates) {
        const absoluteCandidatePath = path.join(__dirname, candidate);

        if (fs.existsSync(absoluteCandidatePath)) {
            return candidate;
        }
    }

    return candidates[0];
}

function getSpriteFrame(basePathWithoutExtension) {
    return pickExistingAssetPath([
        basePathWithoutExtension + ".png",
        basePathWithoutExtension + ".PNG",
        basePathWithoutExtension + ".svg",
        basePathWithoutExtension + ".SVG"
    ]);
}

function shuffleSongs(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    let songs = [];
    let playQueue = [];
    let currentSongIndex = 0;
    let loopEnabled = false;
    let isHovering = false;
    let isSleeping = false;
    let hasPlayedInitialClickAnimation = false;
    const clickFrame0 = "assets/click/Click_0.png";
    const clickFrame1 = "assets/click/Click_1.png";
    const clickFrame2 = "assets/click/Click_2.png";
    const clickFrame3 = "assets/click/Click_3.svg";
    const randomClickFrames = isElectronRuntime
        ? [clickFrame1, clickFrame2, clickFrame3].filter((framePath) => {
              const absoluteFramePath = path.join(__dirname, framePath);
              return fs.existsSync(absoluteFramePath);
          })
        : [clickFrame1, clickFrame2, clickFrame3];

    const character = document.getElementById("character");
    const audio = document.getElementById("audio-player");
    const source = document.getElementById("audio-source");
    const title = document.getElementById("song-title");
    const progressBar = document.getElementById("progress-bar");
    const timeDisplay = document.getElementById("time-display");
    const volumeSlider = document.getElementById("volume");
    const playIcon = document.getElementById("play-icon");
    const loopButton = document.getElementById("loopButton");
    const loopIcon = document.getElementById("loopIcon");
    const menuButton = document.getElementById("menu-button");
    let webMenuOverlay = null;
    let webMenuList = null;

    const sequences = {
        idle: {
            frames: Array.from({ length: 5 }, (_, i) => getSpriteFrame("assets/idle/idle_" + i)),
            fps: 5,
            loop: true
        },
        blink: {
            frames: Array.from({ length: 5 }, (_, i) => getSpriteFrame("assets/blink/blink_" + i)),
            fps: 7,
            loop: false
        },
        dance: {
            frames: Array.from({ length: 8 }, (_, i) => getSpriteFrame("assets/dance/Dance_" + i)),
            fps: 7,
            loop: true
        },
        sleep: {
            frames: Array.from({ length: 6 }, (_, i) => getSpriteFrame("assets/sleep/sleep_" + i)),
            fps: 6,
            loop: true
        },
        click: {
            frames: [clickFrame0],
            fps: 1,
            loop: false
        }
    };

    let state = "idle";
    let frameIndex = 0;
    let animationTimerId = null;
    let inactivityTimer = null;
    let idleLoopsUntilBlink = getNextBlinkLoopCount();
    const sleepDelayMs = 30 * 60 * 1000;
    let rafTitleFitId = null;
    let lastFittedTitleText = "";
    let isWindowVisible = !document.hidden;
    let lastActivityAt = 0;
    const activityThrottleMs = 250;
    const textFitCache = new Map();

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

    function scheduleSongTitleFit(force = false) {
        if (!force && lastFittedTitleText === title.textContent && rafTitleFitId !== null) {
            return;
        }

        lastFittedTitleText = title.textContent;

        if (rafTitleFitId !== null) {
            cancelAnimationFrame(rafTitleFitId);
        }

        rafTitleFitId = requestAnimationFrame(() => {
            rafTitleFitId = null;
            fitTextToWidth(title, 21, 12);
        });
    }

    function ensureWebMenuOverlay() {
        if (isElectronRuntime || webMenuOverlay) {
            return;
        }

        webMenuOverlay = document.createElement("div");
        webMenuOverlay.style.position = "fixed";
        webMenuOverlay.style.inset = "0";
        webMenuOverlay.style.background = "rgba(10, 14, 28, 0.75)";
        webMenuOverlay.style.backdropFilter = "blur(3px)";
        webMenuOverlay.style.zIndex = "9999";
        webMenuOverlay.style.display = "none";
        webMenuOverlay.style.alignItems = "center";
        webMenuOverlay.style.justifyContent = "center";
        webMenuOverlay.style.padding = "18px";

        const panel = document.createElement("div");
        panel.style.width = "min(520px, 100%)";
        panel.style.maxHeight = "78vh";
        panel.style.background = "#1a243a";
        panel.style.border = "2px solid #4d648f";
        panel.style.borderRadius = "16px";
        panel.style.boxShadow = "0 18px 46px rgba(0, 0, 0, 0.45)";
        panel.style.display = "flex";
        panel.style.flexDirection = "column";
        panel.style.overflow = "hidden";

        const header = document.createElement("div");
        header.style.display = "flex";
        header.style.alignItems = "center";
        header.style.justifyContent = "space-between";
        header.style.padding = "12px 14px";
        header.style.background = "#22304d";
        header.style.color = "#ffffff";
        header.style.fontFamily = "\"Pixelify Sans\", sans-serif";
        header.style.fontSize = "18px";
        header.textContent = "Song Library";

        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.textContent = "Close";
        closeButton.style.border = "none";
        closeButton.style.borderRadius = "10px";
        closeButton.style.padding = "6px 10px";
        closeButton.style.cursor = "pointer";
        closeButton.style.fontFamily = "\"Pixelify Sans\", sans-serif";
        closeButton.style.fontSize = "14px";
        closeButton.style.background = "#4d648f";
        closeButton.style.color = "#ffffff";
        closeButton.addEventListener("click", () => {
            if (webMenuOverlay) {
                webMenuOverlay.style.display = "none";
            }
        });
        header.appendChild(closeButton);

        webMenuList = document.createElement("div");
        webMenuList.style.padding = "10px";
        webMenuList.style.overflowY = "auto";
        webMenuList.style.display = "grid";
        webMenuList.style.gap = "8px";

        panel.appendChild(header);
        panel.appendChild(webMenuList);
        webMenuOverlay.appendChild(panel);
        webMenuOverlay.addEventListener("click", (event) => {
            if (event.target === webMenuOverlay) {
                webMenuOverlay.style.display = "none";
            }
        });
        document.body.appendChild(webMenuOverlay);
    }

    function renderWebMenuSongs() {
        if (isElectronRuntime || !webMenuList) {
            return;
        }

        webMenuList.innerHTML = "";

        if (!playQueue.length) {
            const emptyState = document.createElement("div");
            emptyState.textContent = "No songs found.";
            emptyState.style.color = "#cfe0ff";
            emptyState.style.fontFamily = "\"Pixelify Sans\", sans-serif";
            emptyState.style.padding = "8px 4px";
            webMenuList.appendChild(emptyState);
            return;
        }

        playQueue.forEach((song, index) => {
            const itemButton = document.createElement("button");
            itemButton.type = "button";
            itemButton.style.width = "100%";
            itemButton.style.textAlign = "left";
            itemButton.style.padding = "10px";
            itemButton.style.border = "1px solid #4d648f";
            itemButton.style.borderRadius = "10px";
            itemButton.style.background = index === currentSongIndex ? "#35507f" : "#2a3b5c";
            itemButton.style.color = "#ffffff";
            itemButton.style.cursor = "pointer";
            itemButton.style.fontFamily = "\"Pixelify Sans\", sans-serif";
            itemButton.style.fontSize = "14px";
            itemButton.textContent = song.title;
            itemButton.addEventListener("click", () => {
                if (loadSong(index)) {
                    audio.play();
                }

                if (webMenuOverlay) {
                    webMenuOverlay.style.display = "none";
                }
            });
            webMenuList.appendChild(itemButton);
        });
    }

    function toggleWebMenu() {
        if (isElectronRuntime) {
            return;
        }

        ensureWebMenuOverlay();
        renderWebMenuSongs();

        if (webMenuOverlay) {
            webMenuOverlay.style.display = webMenuOverlay.style.display === "flex" ? "none" : "flex";
        }
    }

    function getNextBlinkLoopCount() {
        return Math.random() > 0.5 ? 1 : 2;
    }

    function getNextCharacterClickFrame() {
        if (!hasPlayedInitialClickAnimation) {
            hasPlayedInitialClickAnimation = true;
            return clickFrame0;
        }

        if (!randomClickFrames.length) {
            return clickFrame0;
        }

        const randomIndex = Math.floor(Math.random() * randomClickFrames.length);
        return randomClickFrames[randomIndex];
    }

    function clearInactivityTimer() {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
    }

    function resetInactivityTimer() {
        clearInactivityTimer();

        if (!audio.paused) {
            return;
        }

        inactivityTimer = setTimeout(() => {
            if (audio.paused) {
                isSleeping = true;
                syncCharacterState();
            }
        }, sleepDelayMs);
    }

    function playSequence(name) {
        state = name;
        frameIndex = 0;
        const sequence = sequences[name];
        const nextFrameSrc = sequence.frames[0];

        if (character.src !== nextFrameSrc) {
            character.src = nextFrameSrc;
        }

        if (isWindowVisible) {
            scheduleNextAnimationFrame(1000 / sequence.fps);
        }
    }

    function stopAnimationLoop() {
        if (animationTimerId !== null) {
            clearTimeout(animationTimerId);
            animationTimerId = null;
        }
    }

    function scheduleNextAnimationFrame(delayMs) {
        stopAnimationLoop();
        animationTimerId = setTimeout(tickAnimation, delayMs);
    }

    function startAnimationLoop() {
        if (animationTimerId !== null) {
            return;
        }

        scheduleNextAnimationFrame(1000 / sequences[state].fps);
    }

    function tickAnimation() {
        animationTimerId = null;

        if (!isWindowVisible) {
            return;
        }

        const sequence = sequences[state];

        if (!sequence || !sequence.frames.length) {
            return;
        }

        if (sequence.loop) {
            frameIndex += 1;

            if (state === "idle" && audio.paused && !isSleeping) {
                if (frameIndex >= sequence.frames.length) {
                    frameIndex = 0;
                    idleLoopsUntilBlink -= 1;

                    if (idleLoopsUntilBlink <= 0) {
                        idleLoopsUntilBlink = getNextBlinkLoopCount();
                        playSequence("blink");
                        return;
                    }
                }
            }
            else if (frameIndex >= sequence.frames.length) {
                frameIndex = 0;
            }
        } else if (frameIndex + 1 >= sequence.frames.length) {
            syncCharacterState();
            return;
        } else {
            frameIndex += 1;
        }

        const nextFrameSrc = sequence.frames[frameIndex];

        if (character.src !== nextFrameSrc) {
            character.src = nextFrameSrc;
        }

        scheduleNextAnimationFrame(1000 / sequence.fps);
    }

    function syncCharacterState() {
        const nextState = audio.paused ? (isSleeping ? "sleep" : "idle") : "dance";

        if (state !== nextState) {
            if (nextState === "idle") {
                idleLoopsUntilBlink = getNextBlinkLoopCount();
            }

            playSequence(nextState);
        }
    }

    function registerActivity() {
        if (!audio.paused) {
            return;
        }

        const wasSleeping = isSleeping;
        isSleeping = false;

        resetInactivityTimer();

        if (wasSleeping) {
            syncCharacterState();
        } else if (state === "idle") {
            idleLoopsUntilBlink = getNextBlinkLoopCount();
        }
    }

    function registerActivityFromEvent(event) {
        if (!audio.paused) {
            return;
        }

        const now = performance.now();

        if (event && event.type === "mousemove" && now - lastActivityAt < activityThrottleMs) {
            return;
        }

        lastActivityAt = now;
        registerActivity();
    }

    function formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return minutes + ":" + (secs < 10 ? "0" + secs : secs);
    }

    function updateSongTitle() {
        if (!playQueue.length) {
            title.textContent = "No Songs Added";
            scheduleSongTitleFit();
            return;
        }

        title.textContent = playQueue[currentSongIndex].title;
        scheduleSongTitleFit();
    }

    function buildPlayQueue(currentFile) {
        if (!songs.length) {
            playQueue = [];
            currentSongIndex = 0;
            return;
        }

        const nextQueue = songs.map((song) => ({ ...song }));
        shuffleSongs(nextQueue);

        if (currentFile) {
            const currentQueueIndex = nextQueue.findIndex((song) => song.file === currentFile);

            if (currentQueueIndex > 0) {
                const currentSong = nextQueue.splice(currentQueueIndex, 1)[0];
                nextQueue.unshift(currentSong);
            }
        }

        playQueue = nextQueue;
        currentSongIndex = currentFile ? Math.max(playQueue.findIndex((song) => song.file === currentFile), 0) : 0;
    }

    function setSongs(nextSongs) {
        const currentFile = playQueue[currentSongIndex] ? playQueue[currentSongIndex].file : null;
        songs = Array.isArray(nextSongs) ? nextSongs.map((song) => ({ ...song })) : [];
        buildPlayQueue(currentFile);
        updateSongTitle();
        renderWebMenuSongs();
    }

    function removeMissingSong(songFile) {
        songs = songs.filter((song) => song.file !== songFile);
        playQueue = playQueue.filter((song) => song.file !== songFile);

        if (currentSongIndex >= playQueue.length) {
            currentSongIndex = Math.max(playQueue.length - 1, 0);
        }

        updateSongTitle();
        if (ipcRenderer) {
            ipcRenderer.invoke("remove-song", songFile).catch(() => {});
        }
    }

    function loadSong(index) {
        if (!playQueue.length) {
            source.removeAttribute("src");
            audio.load();
            progressBar.value = 0;
            progressBar.style.setProperty("--progress", "0%");
            timeDisplay.textContent = "0:00 / 0:00";
            updateSongTitle();
            return false;
        }

        currentSongIndex = index;
        const song = playQueue[index];
        if (isElectronRuntime) {
            const songPath = path.isAbsolute(song.file) ? song.file : path.join(__dirname, song.file);

            if (!fs.existsSync(songPath)) {
                removeMissingSong(song.file);

                if (!playQueue.length) {
                    loadSong(0);
                    return false;
                }

                return loadSong(Math.min(currentSongIndex, playQueue.length - 1));
            }

            source.src = pathToFileURL(songPath).toString();
        } else {
            source.src = song.file;
        }

        title.textContent = song.title;
        scheduleSongTitleFit();
        audio.load();
        return true;
    }

    function getSongSourceUrl(songFile) {
        if (!isElectronRuntime) {
            return songFile;
        }

        const songPath = path.isAbsolute(songFile) ? songFile : path.join(__dirname, songFile);
        return pathToFileURL(songPath).toString();
    }

    function isCurrentSongLoaded() {
        if (!playQueue.length || currentSongIndex < 0 || currentSongIndex >= playQueue.length) {
            return false;
        }

        const expectedSrc = getSongSourceUrl(playQueue[currentSongIndex].file);
        return audio.currentSrc === expectedSrc || source.src === expectedSrc || source.getAttribute("src") === expectedSrc;
    }

    function updateLoopIcon() {
        loopButton.classList.toggle("active", loopEnabled);

        if (loopEnabled) {
            loopIcon.src = "assets/LoopClicked.svg";
        } else if (isHovering) {
            loopIcon.src = "assets/LoopButtonHover.svg";
        } else {
            loopIcon.src = "assets/LoopButton.svg";
        }
    }

    function syncLoopButtonAnimationState() {
        loopButton.classList.toggle("is-looping", loopEnabled);
    }

    window.updatePlayer = function () {
        if (!playQueue.length) {
            return;
        }

        if (audio.paused) {
            if (!isCurrentSongLoaded() && !loadSong(currentSongIndex)) {
                return;
            }

            audio.play();
        } else {
            audio.pause();
        }
    };

    window.nextSong = function () {
        if (!playQueue.length) {
            return;
        }

        currentSongIndex++;

        if (currentSongIndex >= playQueue.length) {
            currentSongIndex = 0;
        }

        if (loadSong(currentSongIndex)) {
            audio.play();
        }
    };

    window.prevSong = function () {
        if (!playQueue.length) {
            return;
        }

        currentSongIndex--;

        if (currentSongIndex < 0) {
            currentSongIndex = playQueue.length - 1;
        }

        if (loadSong(currentSongIndex)) {
            audio.play();
        }
    };

    audio.addEventListener("loadedmetadata", () => {
        timeDisplay.textContent = "0:00 / " + formatTime(audio.duration);
    });

    audio.addEventListener("play", () => {
        playIcon.src = "assets/pause.svg";
        isSleeping = false;
        clearInactivityTimer();
        syncCharacterState();
    });

    audio.addEventListener("pause", () => {
        playIcon.src = "assets/play.svg";
        isSleeping = false;
        resetInactivityTimer();
        syncCharacterState();
    });

    audio.addEventListener("timeupdate", () => {
        if (!audio.duration) {
            return;
        }

        const progress = (audio.currentTime / audio.duration) * 100;
        progressBar.value = progress;
        progressBar.style.setProperty("--progress", progress + "%");

        const current = formatTime(audio.currentTime);
        const total = formatTime(audio.duration);
        timeDisplay.textContent = current + " / " + total;
    });

    audio.addEventListener("ended", () => {
        if (loopEnabled) {
            audio.currentTime = 0;
            audio.play();
        } else {
            window.nextSong();
        }
    });

    progressBar.addEventListener("input", () => {
        const time = (progressBar.value / 100) * audio.duration;
        audio.currentTime = time;
        progressBar.style.setProperty("--progress", progressBar.value + "%");
    });

    volumeSlider.addEventListener("input", () => {
        audio.volume = volumeSlider.value;
    });

    loopButton.addEventListener("mouseenter", () => {
        isHovering = true;
        updateLoopIcon();
    });

    loopButton.addEventListener("mouseleave", () => {
        isHovering = false;
        updateLoopIcon();
    });

    loopButton.addEventListener("click", () => {
        loopEnabled = !loopEnabled;
        audio.loop = loopEnabled;
        updateLoopIcon();
        syncLoopButtonAnimationState();
    });

    character.addEventListener("click", (event) => {
        if (event.target !== character) {
            return;
        }

        event.stopPropagation();
        registerActivity();
        sequences.click.frames[0] = getNextCharacterClickFrame();
        playSequence("click");
    });

    if (menuButton) {
        menuButton.addEventListener("click", () => {
            if (ipcRenderer) {
                ipcRenderer.send("open-menu");
                return;
            }

            toggleWebMenu();
        });
    }

    if (ipcRenderer) {
        ipcRenderer.on("select-song", (event, file) => {
            const index = playQueue.findIndex((song) => song.file === file);

            if (index !== -1) {
                if (loadSong(index)) {
                    audio.play();
                }
            }
        });

        ipcRenderer.on("songs-updated", (event, nextSongs) => {
            const currentFile = playQueue[currentSongIndex] ? playQueue[currentSongIndex].file : null;
            const activeSrc = audio.currentSrc || source.src || source.getAttribute("src");

            setSongs(nextSongs);

            if (!playQueue.length) {
                loadSong(0);
                return;
            }

            const nextIndex = currentFile
                ? Math.max(playQueue.findIndex((song) => song.file === currentFile), 0)
                : 0;

            currentSongIndex = nextIndex;
            updateSongTitle();

            const expectedCurrentSrc = currentFile ? getSongSourceUrl(currentFile) : null;
            const currentSongStillInQueue = currentFile ? playQueue.some((song) => song.file === currentFile) : false;

            if (!currentFile || activeSrc !== expectedCurrentSrc || !currentSongStillInQueue) {
                loadSong(nextIndex);
            }
        });
    }

    ["click", "keydown", "mousedown"].forEach((eventName) => {
        document.addEventListener(eventName, registerActivityFromEvent);
    });
    document.addEventListener("mousemove", registerActivityFromEvent, { passive: true });

    document.addEventListener("keydown", (event) => {
        if (!ipcRenderer || !event.shiftKey) {
            return;
        }

        if (event.key.toLowerCase() === "w") {
            ipcRenderer.send("widget-toggle-click-through");
        }

        if (event.key.toLowerCase() === "l") {
            ipcRenderer.send("widget-toggle-lock");
        }
    });

    document.addEventListener("visibilitychange", () => {
        isWindowVisible = !document.hidden;

        if (isWindowVisible) {
            startAnimationLoop();
        } else {
            stopAnimationLoop();
        }
    });

    window.addEventListener("beforeunload", () => {
        clearInactivityTimer();
        stopAnimationLoop();

        if (rafTitleFitId !== null) {
            cancelAnimationFrame(rafTitleFitId);
            rafTitleFitId = null;
        }

    });

    const initialSongs = ipcRenderer
        ? await ipcRenderer.invoke("get-songs")
        : await fetch("songs.json")
              .then((response) => response.json())
              .catch(() => [{ title: "Hide", file: "songs/Hide.mp3" }]);

    setSongs(initialSongs);
    loadSong(currentSongIndex);
    audio.volume = volumeSlider.value;
    updateLoopIcon();
    syncLoopButtonAnimationState();
    resetInactivityTimer();
    playSequence("idle");
    scheduleSongTitleFit(true);
});
