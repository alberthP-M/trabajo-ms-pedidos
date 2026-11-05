FROM node:22-alpine AS build
WORKDIR /app
COPY apps/frontend/package.json package.json
RUN npm install
COPY apps/frontend/tsconfig.json tsconfig.json
COPY apps/frontend/vite.config.ts vite.config.ts
COPY apps/frontend/index.html index.html
COPY apps/frontend/src src
ARG VITE_MS_AUTH_URL=http://localhost:3005
ARG VITE_MS_CATALOGO_URL=http://localhost:3001
ARG VITE_MS_PEDIDOS_URL=http://localhost:3002
ENV VITE_MS_AUTH_URL=$VITE_MS_AUTH_URL
ENV VITE_MS_CATALOGO_URL=$VITE_MS_CATALOGO_URL
ENV VITE_MS_PEDIDOS_URL=$VITE_MS_PEDIDOS_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
