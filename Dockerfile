# Stage 1: Build the frontend
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
COPY backend/package*.json ./backend/

# Install dependencies (including backend)
RUN npm install
RUN npm install --prefix backend

# Copy source code
COPY . .

# Build the frontend
RUN npm run build

# Stage 2: Production environment
FROM node:22-alpine AS runner

WORKDIR /app

# Copy backend dependencies
COPY --from=builder /app/backend/package*.json ./backend/
COPY --from=builder /app/backend/node_modules ./backend/node_modules

# Copy backend source code
COPY --from=builder /app/backend ./backend

# Copy built frontend assets
COPY --from=builder /app/dist ./dist

# Install production dependencies only for the root (if any needed for runtime)
# Configuring for production
ENV NODE_ENV=production
ENV PORT=3001

# Expose the port
EXPOSE 3001

# Start the server
CMD ["node", "backend/src/server.js"]
