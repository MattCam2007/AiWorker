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

# Create non-root user matching host UID/GID
RUN groupadd -g 1000 matt && useradd -u 1000 -g 1000 -m -s /bin/bash matt

# Create app directory
WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy application files
COPY server/ ./server/
COPY client/ ./client/
COPY config/ ./config/

# Make app readable by matt
RUN chown -R matt:matt /app

# Create default directories
RUN mkdir -p /workspace && chown matt:matt /workspace

# Switch to matt for Claude CLI install and runtime
USER matt

# Install Claude Code CLI
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH="/home/matt/.local/bin:${PATH}"
ENV DISABLE_AUTOUPDATER=1

# Shell prompt and color configuration
COPY --chown=matt:matt config/.bashrc /home/matt/.bashrc

# tmux configuration (mouse scroll, history)
COPY --chown=matt:matt config/tmux.conf /home/matt/.tmux.conf

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "server/index.js"]
