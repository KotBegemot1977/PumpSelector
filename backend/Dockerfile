# --- Stage 1: Build Frontend ---
FROM node:20-slim AS frontend-builder
WORKDIR /build-frontend
COPY frontend/package*.json ./
# Increase memory limit for Node.js build process
ENV NODE_OPTIONS=--max-old-space-size=3072
# Use npm install for clean build
RUN npm install
COPY frontend/ .
RUN npm run build

# --- Stage 2: Production Image ---
FROM python:3.11-slim
WORKDIR /app

# Install backend dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application
COPY backend/ .

# Copy built frontend from Stage 1 to /dist
# backend/main.py resolves FRONTEND_DIR as os.path.join(BASE_DIR, "../dist")
# Since BASE_DIR is /app, it will find assets at /dist
COPY --from=frontend-builder /build-frontend/dist /dist

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV DB_DIR=/app/data
ENV UPLOAD_DIR=/app/data/uploads

# Ensure data directory exists
RUN mkdir -p /app/data/uploads

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]