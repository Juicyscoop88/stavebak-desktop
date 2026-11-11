#!/usr/bin/env bash
# Windows zkouška desktopu na skutečné ploše. Server se vždy zastaví, i když běh selže.
# Nastavení a první příprava: scripts/windows-smoke/README.md
set -uo pipefail
: "${STAVEBAK_WIN_INSTANCE:?nastav ID EC2 instance}"
: "${STAVEBAK_WIN_BUCKET:?nastav název S3 bucketu}"
export AWS_REGION="${AWS_REGION:-eu-central-1}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="${STAVEBAK_WIN_OUT_DIR:-$(mktemp -d)}"
PREFIX=smoke
MODE="${1:-test}"

stop() { aws ec2 stop-instances --instance-ids "$STAVEBAK_WIN_INSTANCE" >/dev/null 2>&1; echo "Server zastaven."; }
trap stop EXIT

wait_online() {
  aws ec2 wait instance-running --instance-ids "$STAVEBAK_WIN_INSTANCE"
  for _ in $(seq 1 60); do
    [ "$(aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$STAVEBAK_WIN_INSTANCE" --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null)" = Online ] && return 0
    sleep 10
  done
  echo "Server se nepřipojil k SSM." >&2; return 1
}

# remote <timeout s> <powershell>: spustí příkaz na serveru, vypíše výstup, vrátí 0 při Success
remote() {
  local params id status
  params=$(python3 -I -c 'import json,sys; print(json.dumps({"commands":[sys.argv[1]],"executionTimeout":[sys.argv[2]]}))' "$2" "$1")
  id=$(aws ssm send-command --instance-ids "$STAVEBAK_WIN_INSTANCE" --document-name AWS-RunPowerShellScript --timeout-seconds 600 \
    --parameters "$params" --query Command.CommandId --output text) || return 1
  while :; do
    sleep 15
    status=$(aws ssm get-command-invocation --command-id "$id" --instance-id "$STAVEBAK_WIN_INSTANCE" --query Status --output text 2>/dev/null || echo Pending)
    case "$status" in Success|Failed|Cancelled|TimedOut) break;; esac
  done
  aws ssm get-command-invocation --command-id "$id" --instance-id "$STAVEBAK_WIN_INSTANCE" --query StandardOutputContent --output text | tail -60
  [ "$status" = Success ]
}

fetch() { # fetch <soubor>: skript ze S3 na server a spuštění, další argumenty pro skript
  local name="$1"; shift
  echo "\$ErrorActionPreference='Continue'; Read-S3Object -BucketName $STAVEBAK_WIN_BUCKET -Key $PREFIX/$name -File C:\\$name | Out-Null; & C:\\$name $*"
}

# Po předchozím běhu se server může ještě zastavovat a start by selhal
if [ "$(aws ec2 describe-instances --instance-ids "$STAVEBAK_WIN_INSTANCE" --query 'Reservations[0].Instances[0].State.Name' --output text)" = stopping ]; then
  aws ec2 wait instance-stopped --instance-ids "$STAVEBAK_WIN_INSTANCE"
fi
aws ec2 start-instances --instance-ids "$STAVEBAK_WIN_INSTANCE" >/dev/null || exit 1
wait_online || exit 1
for f in provision.ps1 autologon.ps1 smoke.ps1; do aws s3 cp --quiet "$HERE/$f" "s3://$STAVEBAK_WIN_BUCKET/$PREFIX/$f" || exit 1; done

if [ "$MODE" = provision ]; then
  remote 3400 "$(fetch provision.ps1)" || exit 1
  remote 300 "$(fetch autologon.ps1); shutdown /r /t 5" || exit 1
  echo "Příprava hotová."
  exit 0
fi

sleep 90 # přihlášení do plochy po startu
COPYFILE_DISABLE=1 tar --exclude=node_modules --exclude=target --exclude=.git --exclude=dist --exclude='._*' --exclude=scripts/windows-smoke/out -czf "$OUT/desktop.tgz" -C "$ROOT" . || exit 1
aws s3 cp --quiet "$OUT/desktop.tgz" "s3://$STAVEBAK_WIN_BUCKET/$PREFIX/desktop.tgz" || exit 1
RESULT=$(remote 3300 "$(fetch smoke.ps1 -Bucket "$STAVEBAK_WIN_BUCKET" -Prefix "$PREFIX")"); echo "$RESULT"
aws s3 cp --quiet --recursive "s3://$STAVEBAK_WIN_BUCKET/$PREFIX/out/" "$OUT/" 2>/dev/null
echo "Výstupy: $OUT"
echo "$RESULT" | grep -q 'SMOKE_RESULT=PASS'
