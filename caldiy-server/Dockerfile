FROM node:20-alpine

WORKDIR /app

COPY package.json server.js ./

EXPOSE 5555 3000

ENV PORT=5555
ENV WEB_PORT=3000
ENV TIMEZONE=Asia/Kolkata

CMD ["node", "server.js"]
