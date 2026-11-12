FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY services/ms-auth/package.json services/ms-auth/package.json
COPY services/ms-auth/tsconfig.json services/ms-auth/tsconfig.json
COPY tsconfig.base.json tsconfig.base.json
RUN npm install
COPY services/ms-auth/src services/ms-auth/src
RUN npm run build --prefix services/ms-auth

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/services/ms-auth/package.json ./package.json
COPY --from=build /app/services/ms-auth/dist ./dist
COPY services/ms-auth/migrations ./migrations
EXPOSE 3005
CMD ["node", "dist/main.js"]
