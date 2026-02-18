FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tmux \
    bash \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY server/ ./server/
COPY client/ ./client/
COPY config/ ./config/

EXPOSE 3000

CMD ["node", "server/index.js"]
