FROM node:slim

COPY . .

ENTRYPOINT ["node", "index.js"]