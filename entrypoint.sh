#!/bin/sh
set -e

echo "Running database migrations..."
./node_modules/.bin/typeorm -d dist/database/data-source.js migration:run

echo "Starting application..."
exec node dist/main
