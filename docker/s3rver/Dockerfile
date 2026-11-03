FROM node:22-bookworm-slim
WORKDIR /opt/s3rver
RUN npm install --omit=dev --no-audit --no-fund s3rver@3.7.1 \
    && mkdir /data \
    && chown node:node /data
COPY server.cjs ./server.cjs
USER node
EXPOSE 9000
CMD ["node", "server.cjs"]
