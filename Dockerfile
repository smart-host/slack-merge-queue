FROM node:slim

COPY . .

ENTRYPOINT ["node", "dist/index.js"]