# Smart SAC API
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Dependencies first so code changes don't reinstall them; postinstall generates the Prisma client
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER node
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:8000/api/health > /dev/null || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
