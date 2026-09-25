# Immagine volutamente senza passaggi apt-get: better-sqlite3 scarica un binario
# già compilato per linux/x64 e l'healthcheck usa node, così il build funziona
# anche su macchine con accesso limitato ai mirror Debian.

FROM node:22-slim AS dipendenze
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/dati
WORKDIR /app
RUN mkdir -p /dati && chown -R node:node /dati
COPY --from=dipendenze /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
# Esportazione di Airtable letta da `npm run importa`.
COPY dati ./dati
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/salute').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
