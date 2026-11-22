FROM node:22-alpine
WORKDIR /app
COPY mcp-stdio.mjs .
CMD ["node","mcp-stdio.mjs"]
