# Minimal runtime image for the Blobin Hood game server (also serves web/).
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY web ./web
ARG COMMIT=dev
ENV COMMIT=$COMMIT
EXPOSE 8790
USER node
CMD ["node", "server/index.js"]
