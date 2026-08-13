# Stage 1: Build dan install dependencies
FROM node:20-alpine AS builder

# Tentukan direktori kerja
WORKDIR /app

# Salin file package.json saja untuk memanfaatkan caching layer
COPY package.json ./

# Install dependencies produksi saja
RUN npm install --only=production

# Stage 2: Runtime image yang ringan
FROM node:20-alpine AS runner

# Tentukan environment variable produksi
ENV NODE_ENV=production

WORKDIR /app

# Ambil node_modules dan package.json dari stage builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Salin seluruh kode aplikasi (termasuk server.js)
COPY . .

# Gunakan user non-root demi keamanan
USER node

# Buka port aplikasi (sesuaikan dengan port di server.js Anda)
EXPOSE 3000

# Jalankan aplikasi
CMD ["npm", "start"]
