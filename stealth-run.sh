#!/bin/bash

cd "$(dirname "$0")"

mkdir -p ~/Library/Application\ Support/interview-coder-v1/{temp,cache,screenshots,extra_screenshots}

rm -rf dist dist-electron
rm -f .env

npm run build

export NODE_ENV=production
npx electron ./dist-electron/main.js > /dev/null 2>&1 &
