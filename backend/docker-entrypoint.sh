#!/bin/sh
set -e

# Bring the database schema up to date before serving traffic
npx prisma migrate deploy

# Optional demo data for a fresh stack. The seed refuses to touch a database that already has accounts.
if [ "$SEED_DEMO" = "true" ]; then
  node src/seed.js --allow-production || echo "Skipping demo seed (database already has data)."
fi

exec node src/index.js
