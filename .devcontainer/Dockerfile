ARG VARIANT="20"
FROM mcr.microsoft.com/devcontainers/javascript-node:1-${VARIANT}

USER root

# CLI tooling for agents
RUN npm install -g @openai/codex

# Seed Codex MCP config (copying in as node user config)
RUN mkdir -p /home/node/.config/codex
COPY .devcontainer/codex/config.toml /home/node/.config/codex/config.toml
RUN chown -R node:node /home/node/.config

USER node
