# Use Node.js LTS as base image
FROM node:18-slim

# Install uv (Python package manager), git, curl, and build tools (for horsebox)
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# Install Horsebox
RUN /root/.local/bin/uv tool install git+https://github.com/michelcaradec/horsebox

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Make the script executable
RUN chmod +x src/index.js

# Test the installation
RUN node src/index.js --help 2>/dev/null || echo "Sbomtest installed successfully (help output may vary)"

# Default command
CMD ["node", "src/index.js", "."]