# Build the Vite frontend and bundled Express server with the supported Node runtime.
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . ./
RUN npm run build

# The runtime contains only built artifacts and production dependencies.
FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/server-dist ./server-dist

CMD ["node", "server-dist/server.cjs"]
