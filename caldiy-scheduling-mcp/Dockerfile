FROM node:22-alpine

WORKDIR /app

# Native build deps for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
RUN ./node_modules/.bin/tsc

COPY policy.yaml ./policy.yaml

ENV NODE_ENV=production
ENV MCP_PROFILE=public
ENV MCP_TRANSPORT=http
ENV MCP_HTTP_PORT=3333
ENV DATA_DIR=/app/data

VOLUME ["/app/data"]

EXPOSE 3333

CMD ["node", "dist/index.js"]
