# Discord Bot — Production Dockerfile
FROM node:22-alpine

# Install system dependencies for audio processing
# yt-dlp is installed via pip (cross-platform, always up-to-date binary)
RUN apk add --no-cache \
    python3 \
    py3-pip \
    make \
    g++ \
    ffmpeg \
    curl \
    opus-dev \
    opusfile-dev \
    libtool \
    autoconf \
    automake \
    && pip3 install --no-cache-dir --break-system-packages yt-dlp \
    && rm -rf /var/cache/apk/*

# Create app directory
WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application code
COPY src/ ./src/
COPY migrations/ ./migrations/
COPY scripts/ ./scripts/

# Create necessary directories
RUN mkdir -p logs data

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S botuser -u 1001 && \
    chown -R botuser:nodejs /app

USER botuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["node", "--dns-result-order=ipv4first", "src/index.js"]
