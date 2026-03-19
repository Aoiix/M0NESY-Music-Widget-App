const { ipcRenderer } = require("electron");

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
    let hasShownLaunchClickCharacter = false;

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

    const sequences = {
        idle: {
            frames: Array.from({ length: 5 }, (_, i) => "assets/idle/idle_" + i + ".png"),
            fps: 5,
            loop: true
        },
        blink: {
            frames: Array.from({ length: 5 }, (_, i) => "assets/blink/blink_" + i + ".png"),
            fps: 7,
            loop: false
        },
        dance: {
            frames: Array.from({ length: 8 }, (_, i) => "assets/dance/Dance_" + i + ".PNG"),
            fps: 7,
            loop: true
        },
        sleep: {
            frames: Array.from({ length: 6 }, (_, i) => "assets/sleep/sleep_" + i + ".png"),
            fps: 6,
            loop: true
        },
        click: {
            frames: ["assets/click/Click_0.png"],
            fps: 1,
            loop: false
        }
    };

    let state = "idle";
    let frameIndex = 0;
    let animationTimer = null;
    let inactivityTimer = null;
    let idleLoopsUntilBlink = getNextBlinkLoopCount();
    const sleepDelayMs = 30 * 60 * 1000;

    function fitTextToWidth(element, maxFontSize, minFontSize) {
        element.style.fontSize = maxFontSize + "px";

        while (element.scrollWidth > element.clientWidth && maxFontSize > minFontSize) {
            maxFontSize -= 1;
            element.style.fontSize = maxFontSize + "px";
        }
    }

    function getNextBlinkLoopCount() {
        return Math.random() > 0.5 ? 1 : 2;
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
        clearInterval(animationTimer);
        state = name;
        frameIndex = 0;

        const sequence = sequences[name];
        const frameTime = 1000 / sequence.fps;

        character.src = sequence.frames[0];

        animationTimer = setInterval(() => {
            frameIndex++;

            if (frameIndex >= sequence.frames.length) {
                if (sequence.loop) {
                    frameIndex = 0;

                    if (name === "idle" && audio.paused && !isSleeping) {
                        idleLoopsUntilBlink--;

                        if (idleLoopsUntilBlink <= 0) {
                            idleLoopsUntilBlink = getNextBlinkLoopCount();
                            playSequence("blink");
                            return;
                        }
                    }
                } else {
                    syncCharacterState();
                    return;
                }
            }

            character.src = sequence.frames[frameIndex];
        }, frameTime);
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

    function formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return minutes + ":" + (secs < 10 ? "0" + secs : secs);
    }

    function updateSongTitle() {
        if (!playQueue.length) {
            title.textContent = "No Songs Added";
            fitTextToWidth(title, 21, 12);
            return;
        }

        title.textContent = playQueue[currentSongIndex].title;
        fitTextToWidth(title, 21, 12);
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
    }

    function loadSong(index) {
        if (!playQueue.length) {
            source.removeAttribute("src");
            audio.load();
            progressBar.value = 0;
            progressBar.style.setProperty("--progress", "0%");
            timeDisplay.textContent = "0:00 / 0:00";
            updateSongTitle();
            return;
        }

        currentSongIndex = index;
        source.src = playQueue[index].file;
        title.textContent = playQueue[index].title;
        fitTextToWidth(title, 21, 12);
        audio.load();
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

    window.updatePlayer = function () {
        if (!playQueue.length) {
            return;
        }

        if (audio.paused) {
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

        loadSong(currentSongIndex);
        audio.play();
    };

    window.prevSong = function () {
        if (!playQueue.length) {
            return;
        }

        currentSongIndex--;

        if (currentSongIndex < 0) {
            currentSongIndex = playQueue.length - 1;
        }

        loadSong(currentSongIndex);
        audio.play();
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
    });

    character.addEventListener("click", (event) => {
        if (event.target !== character) {
            return;
        }

        event.stopPropagation();
        registerActivity();

        if (hasShownLaunchClickCharacter) {
            return;
        }

        hasShownLaunchClickCharacter = true;
        playSequence("click");
    });

    menuButton.addEventListener("click", () => {
        ipcRenderer.send("open-menu");
    });

    ipcRenderer.on("select-song", (event, file) => {
        const index = playQueue.findIndex((song) => song.file === file);

        if (index !== -1) {
            loadSong(index);
            audio.play();
        }
    });

    ipcRenderer.on("songs-updated", (event, nextSongs) => {
        const currentFile = playQueue[currentSongIndex] ? playQueue[currentSongIndex].file : null;
        const activeFile = source.getAttribute("src");

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

        if (!currentFile || activeFile !== currentFile || !playQueue.some((song) => song.file === activeFile)) {
            loadSong(nextIndex);
        }
    });

    ["click", "mousemove", "keydown", "mousedown"].forEach((eventName) => {
        document.addEventListener(eventName, registerActivity);
    });

    const initialSongs = await ipcRenderer.invoke("get-songs");
    setSongs(initialSongs);
    loadSong(currentSongIndex);
    audio.volume = volumeSlider.value;
    updateLoopIcon();
    resetInactivityTimer();
    playSequence("idle");
});
