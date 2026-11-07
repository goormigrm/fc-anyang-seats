#!/bin/sh
# 올리기(push) 전 자동 시험: 하나라도 실패하면 올리지 않음 (올리면 바로 GitHub Pages 에 반영되므로)
# 설치: ln -sf ../../tools/pre-push.sh .git/hooks/pre-push
cd "$(git rev-parse --show-toplevel)" || exit 1
PATH="$HOME/work/node/bin:$PATH" node tools/test.js || { echo '자동 시험 실패: 올리지 않습니다'; exit 1; }
