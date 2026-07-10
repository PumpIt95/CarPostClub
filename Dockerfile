FROM node:22-bookworm-slim

ARG CARPOSTCLUB_RELEASE_ID=docker-build
ARG CARPOSTCLUB_SOURCE_COMMIT=unknown
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
RUN node scripts/build_release_manifest.mjs \
  --root . \
  --output release-manifest.json \
  --release-id "$CARPOSTCLUB_RELEASE_ID" \
  --source-commit "$CARPOSTCLUB_SOURCE_COMMIT" \
  --source docker-build

EXPOSE 3911
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3911/healthz',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
