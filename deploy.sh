#!/bin/bash
# 가족 화면을 다시 올린다: 빌드 → dist 를 gh-pages 브랜치로 → 1분 안에 https://kevin10163963.github.io/gyeote/ 에 반영
set -e
cd "$(dirname "$0")"
npm run build
touch dist/.nojekyll
cd dist && rm -rf .git && git init -q && git checkout -qb gh-pages && git add -A && git commit -qm "배포 $(date +%H:%M)"
git push -qf https://github.com/kevin10163963/gyeote.git gh-pages
rm -rf .git
echo "올림: https://kevin10163963.github.io/gyeote/"
