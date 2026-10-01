FROM node:20-alpine

WORKDIR /app

COPY package.json server.js ./

EXPOSE 5555 3000

ENV PORT=5555
ENV WEB_PORT=3000
ENV CAL_API_KEY=cal_live_28a9b73491c107297eef840f34581290
ENV TIMEZONE=Asia/Kolkata

CMD ["node", "server.js"]
