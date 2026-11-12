FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY services/ms-pagos/package.json services/ms-pagos/package.json
COPY services/ms-pagos/tsconfig.json services/ms-pagos/tsconfig.json
WORKDIR /app/services/ms-pagos
RUN npm install
WORKDIR /app
COPY services/ms-pagos/src services/ms-pagos/src
RUN npm run build --prefix services/ms-pagos

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/services/ms-pagos/node_modules ./node_modules
COPY --from=build /app/services/ms-pagos/package.json ./package.json
COPY --from=build /app/services/ms-pagos/dist ./dist
COPY services/ms-pagos/migrations ./migrations
EXPOSE 3003
CMD ["node", "dist/main.js"]
