FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY website ./website

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/app/data/faceitwatcher.db

VOLUME /app/data
EXPOSE 3000

CMD ["node", "--disable-warning=ExperimentalWarning", "--import", "tsx", "src/server.ts"]
