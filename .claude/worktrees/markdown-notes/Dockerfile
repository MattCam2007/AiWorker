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
    gosu \
    bash-completion \
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

# Create default directories
RUN mkdir -p /workspace

# Copy and enable entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose port
EXPOSE 3000

# Entrypoint handles user creation and privilege drop
ENTRYPOINT ["/entrypoint.sh"]

# Start the application
CMD ["node", "server/index.js"]
