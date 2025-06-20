# This Dockerfile packages the Next.js application for production.
# It uses a multi-stage build to keep the final image small and focused.
# The build stage installs dependencies and compiles the Next.js app.
# The runtime stage only contains the compiled output and required node modules.

# ---- Build Stage ----
FROM node:20-alpine AS build
WORKDIR /app

# Copy package files first to leverage Docker layer caching when deps don't change
COPY package*.json ./
RUN npm ci

# Copy the rest of the project and build
COPY . .
RUN npm run build

# ---- Runtime Stage ----
FROM node:20-alpine
WORKDIR /app

# Only copy node_modules and built output from the build stage
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json

EXPOSE 3000
CMD ["npm", "start"]
