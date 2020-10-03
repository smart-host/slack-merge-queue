FROM node:slim

COPY . .

ENTRYPOINT ["node", "src/index.js"]