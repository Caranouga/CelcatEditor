FROM node:22-alpine AS builder

WORKDIR /app

# Enable Corepack so the Yarn version from package.json is used
RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./

# Install dependencies exactly from the lockfile
RUN yarn install --immutable

COPY . .

# Build the application
RUN yarn build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./

# Install dependencies
RUN yarn install --immutable

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["yarn", "start"]