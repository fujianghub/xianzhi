#!/usr/bin/env bash
# 验证实例用：子进程异常退出后 0.5s 自动拉起（模拟生产容器 restart 策略，REQ-COLLAB-011 e2e 依赖）。
# 收到 TERM / INT（concurrently -k 收尾）时转发给子进程并退出，不再拉起。
child=0
stop() {
  [ "$child" -ne 0 ] && kill -TERM "$child" 2>/dev/null
  wait "$child" 2>/dev/null
  exit 0
}
trap stop TERM INT
while true; do
  "$@" &
  child=$!
  wait "$child"
  code=$?
  [ "$code" -eq 0 ] && exit 0
  echo "[respawn] exited with $code, restarting…" >&2
  sleep 0.5
done
