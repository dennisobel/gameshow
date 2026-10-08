# syntax=docker/dockerfile:1
#
# The web app is an npm workspace, so this image is built from the REPOSITORY
# ROOT (see docker-compose.yml): it installs from the root lockfile, then builds
# only apps/web. Dockerfile.dockerignore, next to this file, keeps the rest of the
# repository out of the build context.

FROM node:22-alpine AS build
WORKDIR /src

# Manifests first, so a source-only change does not reinstall the dependencies.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @ontheboard/web

COPY apps/web apps/web
# Empty by default: nginx below proxies /v1 to the API, so the app is
# same-origin and needs no absolute API URL (and no CORS).
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build --workspace @ontheboard/web

FROM nginx:1.27-alpine
COPY --from=build /src/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
