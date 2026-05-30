FROM node:22-bookworm-slim

ARG CARPOSTCLUB_RELEASE_ID=docker-build
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
RUN node scripts/build_release_manifest.mjs \
  --root . \
  --output release-manifest.json \
  --release-id "$CARPOSTCLUB_RELEASE_ID" \
  --source docker-build

EXPOSE 3911
CMD ["node", "server.js"]
