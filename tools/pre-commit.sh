#!/bin/sh
# 커밋 전: index.html 이 커밋에 들어가면 현황판 판(APP_VERSION)을 지금 시각(KST)으로 바꿔 같이 넣음 (화면 아래, 입력 화면 맨 위에 보이는 판)
# 설치: ln -sf ../../tools/pre-commit.sh .git/hooks/pre-commit
cd "$(git rev-parse --show-toplevel)" || exit 1
git diff --cached --quiet -- index.html && exit 0          # index.html 을 안 바꾼 커밋은 그대로
if ! git diff --quiet -- index.html; then                   # 커밋에 넣지 않은 index.html 변경이 있으면 섞이지 않게 건너뜀
  echo 'pre-commit: index.html 에 커밋하지 않는 변경이 있어 판 번호를 바꾸지 않았습니다'; exit 0
fi
v=$(TZ=Asia/Seoul date '+%Y.%m.%d %H:%M')
sed -i "s/^const APP_VERSION = '[^']*';/const APP_VERSION = '$v';/" index.html && git add index.html
