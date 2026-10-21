# Smart SAC web app: built once, served by nginx, which also proxies /api to the backend
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Same-origin API through nginx, so cookies are first-party
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_APP_TIMEZONE=Asia/Kolkata
ARG VITE_SENTRY_DSN=
ARG VITE_SITE_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL VITE_APP_TIMEZONE=$VITE_APP_TIMEZONE VITE_SENTRY_DSN=$VITE_SENTRY_DSN VITE_SITE_URL=$VITE_SITE_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1/ > /dev/null || exit 1
