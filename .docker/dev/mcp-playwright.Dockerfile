FROM mcr.microsoft.com/playwright:v1.59.0-jammy

# Bake the Playwright MCP server + the browser it drives so the
# container is self-contained on first boot. The stock playwright
# image ships chromium-1217, but @playwright/mcp@latest (>=0.0.75)
# launches via the newer ``chrome-for-testing`` channel and falls
# back to ``chromium-headless-shell-1224``; without the install
# below the first request fails with ``Browser "chrome-for-testing"
# is not installed``.

ENV PNPM_HOME=/root/.local/share/pnpm \
    NODE_ENV=production

# Pin the MCP server version so the image is reproducible. Bump in
# lockstep with the playwright base image when upstream cuts a new
# major release. ``npm install -g`` lays it under
# /usr/lib/node_modules so subsequent containers do not have to
# re-download via ``npx``.
ARG PLAYWRIGHT_MCP_VERSION=0.0.75
RUN npm install -g @playwright/mcp@${PLAYWRIGHT_MCP_VERSION}

# Pre-install the browser channel via the MCP's own install-browser
# subcommand. The MCP server bundles its own ``playwright-core``
# whose browser revisions diverge from the base image's playwright,
# so we MUST go through the MCP entrypoint - calling the system
# ``playwright install`` pulls the wrong revision and the server
# still complains at runtime.
RUN playwright-mcp install-browser chrome-for-testing \
    && rm -rf /root/.npm /tmp/*

EXPOSE 8931

# ``--isolated`` keeps every browsing session in a fresh profile, so
# auth state from one Claude Code conversation never bleeds into
# the next.
ENTRYPOINT ["playwright-mcp"]
CMD ["--port", "8931", "--host", "0.0.0.0", "--browser", "chromium", "--headless", "--isolated"]
