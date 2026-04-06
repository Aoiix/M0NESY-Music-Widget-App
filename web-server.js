const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 4173;
const HOST = "127.0.0.1";
const ROOT = __dirname;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".webmanifest": "application/manifest+json"
};

function getFilePath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const relativePath = cleanPath === "/" ? "/index.html" : cleanPath;
  return path.join(ROOT, relativePath);
}

const server = http.createServer((req, res) => {
  const filePath = getFilePath(req.url || "/");
  const normalizedPath = path.normalize(filePath);

  if (!normalizedPath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(normalizedPath, (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.writeHead(404);
        res.end("Not found");
      } else {
        res.writeHead(500);
        res.end("Server error");
      }

      return;
    }

    const ext = path.extname(normalizedPath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`PWA server running at http://${HOST}:${PORT}`);
});
