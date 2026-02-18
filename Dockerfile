FROM debian:bookworm-slim

# Install system dependencies (build-essential needed for node-pty native compilation)
RUN apt-get update && apt-get install -y \
    curl \
    tmux \
    bash \
    git \
    procps \
    build-essential \
    python3 \
    vim \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy application files
COPY server/ ./server/
COPY client/ ./client/
COPY config/ ./config/

# Install Claude Code CLI (native binary — no Node.js dependency)
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH="/root/.claude/local/bin:${PATH}"
ENV DISABLE_AUTOUPDATER=1

# Shell prompt and color configuration
COPY config/.bashrc /root/.bashrc

# Create default directories
RUN mkdir -p /workspace

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "server/index.js"]
