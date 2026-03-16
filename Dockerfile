FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies (production only)
RUN npm ci --omit=dev

# Copy source and static files
COPY src ./src
COPY public ./public
COPY data ./data
COPY qrcode.png ./qrcode.png

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup && \
    chown -R appuser:appgroup /app

USER appuser

# Expose backend and frontend ports
EXPOSE 3000 5173

# Start both backend and frontend
CMD ["sh", "-c", "node src/server.js & node src/frontend-server.js"]
