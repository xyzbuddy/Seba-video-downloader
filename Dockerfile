# Seba Downloader: API server (and the website it serves) in one container.
#
# Includes everything downloads need at runtime:
#   - ffmpeg  (joins HD picture and sound on the fly)
#   - Python  (keeps yt-dlp loaded between lookups, a few seconds faster)
#   - yt-dlp  (downloaded during `pnpm install` by scripts/download-ytdlp.js)
#
# Deploy on Render / Railway / Fly.io / any VPS as a Docker service.
# The platform sets PORT; locally it defaults to 8080.

FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Let the postinstall script install yt-dlp's Python package into the app folder
ENV PIP_BREAK_SYSTEM_PACKAGES=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    SEBA_PYTHON=python3

RUN npm install -g pnpm@10.33.0

WORKDIR /app
COPY . .

# Installs dependencies, downloads yt-dlp for Linux and the Python worker's
# package, then builds the API server and the website.
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @workspace/api-server --filter @workspace/diu-yt-downloader run build

ENV NODE_ENV=production \
    PORT=8080
EXPOSE 8080

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
