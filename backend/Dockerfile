FROM node:22.23.2-alpine AS deps
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev

FROM node:22.23.2-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY backend/ .
COPY shared/ ./shared/

EXPOSE 4000
CMD ["node", "src/server.js"]
