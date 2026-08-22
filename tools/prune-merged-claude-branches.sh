#!/bin/bash
# =====================================================================
# prune-merged-claude-branches.sh — 用済みの claude/ ブランチを消す
# =====================================================================
# なぜ要るか:
#   squash マージのリポジトリでは、マージ後もブランチが「squash 前の
#   コミット」を抱えたまま残る。そこに新しい作業を積むと、PR の差分に
#   すでに main に入っている変更が再び現れ、main 側が後からその行を
#   触っていると mergeable_state が dirty になる。
#   その状態の PR は、CI が**失敗ではなく1件もスケジュールされない**
#   （pull_request のチェックはマージコミットに対して走るため）。
#   緑でも赤でもない PR は見落としてマージされる。
#   2026-08-22 の時点で 42 リポジトリに 175 本たまっていた。
#
# 何を消すか:
#   「そのブランチが main に無い内容を持っていない」ものだけ。
#   ブランチにしかないファイルや、中身がブランチ側のほうが新しい
#   ファイルが1つでもあれば、消さずに残して報告する。
#
# 使い方:
#   bash tools/prune-merged-claude-branches.sh          # 下見（消さない）
#   bash tools/prune-merged-claude-branches.sh --delete # 実際に消す
#
#   ブランチの削除には push の権限が要る。権限が無いと 403 で失敗する
#   （Claude Code のセッションからは消せなかった）。
# =====================================================================
set -u
ROOT="${GIGA_REPOS:-/home/user}"
DELETE=0
[ "${1:-}" = "--delete" ] && DELETE=1
KEEP_SUFFIX="${KEEP_SUFFIX:-}"   # 例: KEEP_SUFFIX=-0822 で今日の作業を守る

safe=0; kept=0; done_=0; failed=0
for d in "$ROOT"/*/; do
  [ -d "$d/.git" ] || continue
  repo=$(basename "$d")
  git -C "$d" fetch origin --prune -q '+refs/heads/*:refs/remotes/origin/*' 2>/dev/null
  H=$(git -C "$d" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)
  for ref in $(git -C "$d" for-each-ref --format='%(refname:short)' refs/remotes/origin/claude 2>/dev/null); do
    br=${ref#origin/}
    [ -n "$KEEP_SUFFIX" ] && case "$br" in *"$KEEP_SUFFIX") continue;; esac

    # ブランチと main で中身の違うファイルが1つでもあれば消さない。
    # ⚠️ ここは安全側に倒してある。「ブランチのほうが新しい」だけでなく
    #    「main が先に進んだ」場合も残す。どちらなのかは中身を見ないと
    #    決められないので、理由になったファイル名を出して人に判断を渡す。
    extra=0; why=""
    for f in $(git -C "$d" diff --name-only "$H...$ref" 2>/dev/null); do
      inB=0; inM=0
      git -C "$d" cat-file -e "$ref:$f"  2>/dev/null && inB=1
      git -C "$d" cat-file -e "$H:$f"    2>/dev/null && inM=1
      if [ $inB -eq 1 ] && [ $inM -eq 0 ]; then extra=1; why="$why $f(ブランチにのみ)"; fi
      if [ $inB -eq 1 ] && [ $inM -eq 1 ]; then
        git -C "$d" diff --quiet "$ref:$f" "$H:$f" 2>/dev/null || { extra=1; why="$why $f(中身が違う)"; }
      fi
    done

    if [ $extra -ne 0 ]; then
      kept=$((kept+1)); echo "  残す  $repo  $br →$why"; continue
    fi
    safe=$((safe+1))
    if [ $DELETE -eq 1 ]; then
      if git -C "$d" push origin --delete "$br" -q 2>/dev/null; then done_=$((done_+1))
      else failed=$((failed+1)); echo "  失敗  $repo  $br"; fi
    else
      echo "  消せる $repo  $br"
    fi
  done
done

echo
echo "消せる: $safe 本 / 残す: $kept 本"
[ $DELETE -eq 1 ] && echo "実際に消した: $done_ 本 / 失敗: $failed 本"
