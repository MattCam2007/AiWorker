FROM debian:bookworm-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    tmux \
    bash \
    git \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy application files
COPY server/ ./server/
COPY client/ ./client/
COPY config/ ./config/

# Create default directories
RUN mkdir -p /workspace

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "server/index.js"]
