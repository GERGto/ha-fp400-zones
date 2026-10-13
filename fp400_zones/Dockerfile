FROM node:22-alpine

WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY app/server.mjs ./
COPY app/security.mjs ./
COPY app/workflow.mjs ./
COPY app/converter ./converter
COPY app/public ./public

ARG BUILD_VERSION
LABEL \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="app" \
  io.hass.arch="aarch64|amd64"

ENV NODE_ENV=production
EXPOSE 8099
CMD ["node", "server.mjs"]
