FROM nginx:1.31.3-alpine

# Patch OS packages to the latest Alpine 3.24 security releases. The base
# image tag pins a snapshot whose openssl, util-linux and libexpat packages
# carry CRITICAL/HIGH CVEs, which would otherwise fail the Trivy gate in the
# Kubernetes deploy pipeline.
RUN apk upgrade --no-cache

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Health check
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:80/ || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
