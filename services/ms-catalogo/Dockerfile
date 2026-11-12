FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/ms-catalogo/package.json services/ms-catalogo/package.json
COPY services/ms-catalogo/tsconfig.json services/ms-catalogo/tsconfig.json
WORKDIR /app/services/ms-catalogo
RUN npm install
WORKDIR /app
COPY services/ms-catalogo/src services/ms-catalogo/src
RUN npm run build --prefix services/ms-catalogo

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/services/ms-catalogo/node_modules ./node_modules
COPY --from=build /app/services/ms-catalogo/package.json ./package.json
COPY --from=build /app/services/ms-catalogo/dist ./dist
COPY services/ms-catalogo/migrations ./migrations
EXPOSE 3001
CMD ["node", "dist/main.js"]
