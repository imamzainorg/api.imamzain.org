FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
RUN npx prisma generate
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist

# Documentation only — the runtime platform decides the real port and injects
# it as PORT (Cloud Run: 8080), which src/main.ts reads. Kept aligned with
# Cloud Run's default so this file doesn't imply a port nothing actually uses.
EXPOSE 8080

# NOTE: migrations are deliberately NOT run here. `prisma migrate deploy` used
# to sit in Render's build command; on Cloud Run the image is built by Cloud
# Build with no database access, and the `prisma` CLI is a devDependency so it
# isn't present in this stage anyway. Run `npm run prisma:deploy` explicitly
# before rolling out a release that needs a schema change.
USER node
CMD ["node", "dist/src/main.js"]