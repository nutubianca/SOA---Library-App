FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
EXPOSE 3004
ENV PORT=3004
CMD ["npm","start"]
