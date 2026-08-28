FROM node:20.20.2-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20.20.2-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app/out ./out
EXPOSE 3000
CMD ["serve", "out", "-l", "3000"]
