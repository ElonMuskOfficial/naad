FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY app.js ./
COPY lib ./lib
COPY plugins ./plugins
COPY routes ./routes

USER node
EXPOSE 3000

CMD ["npm", "start"]
