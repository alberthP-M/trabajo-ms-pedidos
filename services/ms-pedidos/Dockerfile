FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/ms-pedidos/package.json services/ms-pedidos/package.json
COPY services/ms-pedidos/tsconfig.json services/ms-pedidos/tsconfig.json
WORKDIR /app/services/ms-pedidos
RUN npm install
WORKDIR /app
COPY services/ms-pedidos/src services/ms-pedidos/src
RUN npm run build --prefix services/ms-pedidos

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/services/ms-pedidos/node_modules ./node_modules
COPY --from=build /app/services/ms-pedidos/package.json ./package.json
COPY --from=build /app/services/ms-pedidos/dist ./dist
COPY services/ms-pedidos/migrations ./migrations
EXPOSE 3002
CMD ["node", "dist/main.js"]
