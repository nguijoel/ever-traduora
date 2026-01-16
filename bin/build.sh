# /bin/build.sh
#!/bin/sh

set -e

bin/install-deps.sh

# Cleanup
[ -e dist ] && rm -r dist

# Build webapp
cd webapp && yarn build --prod

# Build api
cd ../api && yarn build

# Copy metadata for server-side install in dist
cp -f package.json ../dist/package.json
cp -f ../yarn.lock ../dist/yarn.lock

cp -r node_modules ../dist/
