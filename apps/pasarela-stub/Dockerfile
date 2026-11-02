FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/pasarela-stub/package.json apps/pasarela-stub/package.json
COPY apps/pasarela-stub/tsconfig.json apps/pasarela-stub/tsconfig.json
WORKDIR /app/apps/pasarela-stub
RUN npm install
WORKDIR /app
COPY apps/pasarela-stub/src apps/pasarela-stub/src
RUN npm run build --prefix apps/pasarela-stub

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/pasarela-stub/node_modules ./node_modules
COPY --from=build /app/apps/pasarela-stub/package.json ./package.json
COPY --from=build /app/apps/pasarela-stub/dist ./dist
EXPOSE 3004
CMD ["node", "dist/main.js"]
