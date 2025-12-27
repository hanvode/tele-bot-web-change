# =========================
# STAGE 1: Build
# =========================
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Install build dependencies
# RUN apk add --no-cache python3 make g++

# Copy package.json and package-lock.json first for better caching
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy TypeScript configuration
COPY tsconfig.json ./

# Copy source code
COPY src/ ./src/

# Create logs directory
# RUN mkdir -p logs

# Build TypeScript code
RUN npm run build


# =========================
# STAGE 2: Production Image
# =========================
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package.json — để prune chính xác
COPY package*.json ./

# Copy dist từ stage build
COPY --from=builder /app/dist ./dist

# Copy node_modules và prune chỉ còn deps production
COPY --from=builder /app/node_modules ./node_modules

# Remove dev dependencies to reduce image size
RUN npm prune --production

# Logs folder
RUN mkdir -p logs

# Set environment variables
ENV NODE_ENV=production

# Run as non-root user
RUN addgroup -S appuser && adduser -S appuser -G appuser
# RUN chown -R appuser:appuser /app
USER appuser

# Start the application
CMD ["node", "dist/index.js"]