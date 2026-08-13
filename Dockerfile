# Stage 1: Build dan install dependencies
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./

# Install seluruh dependencies untuk proses build jika diperlukan
RUN npm install --only=production

# Stage 2: Runtime image yang ringan dan aman
FROM node:20-alpine AS runner

ENV NODE_ENV=production
WORKDIR /app

# Ambil node_modules dan package.json dari stage builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Salin seluruh kode aplikasi dari folder lokal
COPY . .

# --- SOLUSI ERROR MKDIR ---
# Membuat folder yang dibutuhkan dan memberikan akses penuh ke user 'node'
RUN mkdir -p /app/uploads /app/workspace && \
    chown -R node:node /app/uploads /app/workspace /app

# Menggunakan user aman non-root setelah folder siap
USER node

# Buka port aplikasi sesuai konfigurasi skrip Anda (Port 5000)
EXPOSE 5000

# Jalankan aplikasi
CMD ["npm", "start"]
