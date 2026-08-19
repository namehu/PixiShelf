#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)

FORCE=false
PULL_IMAGES=true
COMPOSE_FILE="${PIXISHELF_COMPOSE_FILE:-}"
ENV_FILE="${PIXISHELF_ENV_FILE:-}"
WAIT_TIMEOUT_SECONDS="${PIXISHELF_UPDATE_WAIT_TIMEOUT_SECONDS:-180}"
READY_POLL_SECONDS="${PIXISHELF_UPDATE_READY_POLL_SECONDS:-5}"
PRE_UPDATE_HOOK="${PIXISHELF_PRE_UPDATE_HOOK:-}"

SCHEDULER_WAS_RUNNING=false
SCHEDULER_STOPPED=false
UPDATE_PHASE="preflight"

log_info() {
  printf '[INFO] %s\n' "$*"
}

log_warn() {
  printf '[WARN] %s\n' "$*" >&2
}

log_error() {
  printf '[ERROR] %s\n' "$*" >&2
}

usage() {
  cat <<'EOF'
Usage: sudo bash ./scripts/update-production.sh [options]

Safely updates the PixiShelf App and general Worker as one release unit.

Options:
  --force                Continue even when executing background jobs exist.
  --no-pull              Recreate services from already available local images.
  --compose-file PATH    Override the production Compose file.
  --env-file PATH        Override the Compose environment file.
  -h, --help             Show this help.

Environment:
  PIXISHELF_COMPOSE_FILE
  PIXISHELF_ENV_FILE
  PIXISHELF_PRE_UPDATE_HOOK
  PIXISHELF_UPDATE_WAIT_TIMEOUT_SECONDS     (default: 180)
  PIXISHELF_UPDATE_READY_POLL_SECONDS       (default: 5)

PIXISHELF_PRE_UPDATE_HOOK must name an executable backup/checkpoint script.
It runs after all application writers stop and before the new App starts.
EOF
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    log_error "Missing required command: $command_name"
    exit 1
  fi
}

require_positive_integer() {
  local name="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    log_error "$name must be a positive integer; received: $value"
    exit 1
  fi
}

resolve_existing_file() {
  local path_value="$1"
  local resolved
  if [[ "$path_value" = /* ]]; then
    resolved="$path_value"
  else
    resolved="$(pwd)/$path_value"
  fi
  if [ ! -f "$resolved" ]; then
    log_error "File does not exist: $resolved"
    exit 1
  fi
  printf '%s\n' "$resolved"
}

detect_compose_file() {
  local candidate
  for candidate in docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do
    if [ -f "$(pwd)/$candidate" ]; then
      printf '%s\n' "$(pwd)/$candidate"
      return 0
    fi
  done
  if [ -f "$REPO_ROOT/build/docker-compose.deploy.yml" ]; then
    printf '%s\n' "$REPO_ROOT/build/docker-compose.deploy.yml"
    return 0
  fi
  log_error "No production Compose file found. Use --compose-file or PIXISHELF_COMPOSE_FILE."
  exit 1
}

service_exists() {
  local service="$1"
  "${COMPOSE[@]}" config --services | grep -Fxq "$service"
}

service_is_running() {
  local service="$1"
  "${COMPOSE[@]}" ps --status running --services | grep -Fxq "$service"
}

executing_job_count() {
  local sql raw count
  sql="SELECT count(*) FROM system_jobs WHERE status IN ('RUNNING', 'PAUSING', 'CANCELLING');"
  raw=$("${COMPOSE[@]}" exec -T postgres sh -c \
    'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "$1"' sh "$sql")
  count=$(printf '%s' "$raw" | tr -d '[:space:]')
  if [[ ! "$count" =~ ^[0-9]+$ ]]; then
    log_error "Could not parse the executing background job count: $raw"
    return 1
  fi
  printf '%s\n' "$count"
}

restore_scheduler_after_preflight_abort() {
  if [ "$SCHEDULER_WAS_RUNNING" = true ] && [ "$SCHEDULER_STOPPED" = true ]; then
    log_info "Restoring scheduler after aborted preflight..."
    "${COMPOSE[@]}" up -d scheduler
    SCHEDULER_STOPPED=false
  fi
}

abort_for_executing_jobs() {
  local count="$1"
  log_error "$count background job(s) are RUNNING, PAUSING, or CANCELLING."
  log_error "Wait for a safe terminal state, or explicitly rerun with --force."
  restore_scheduler_after_preflight_abort
  exit 2
}

wait_for_worker_ready() {
  local started_at current_at elapsed output
  started_at=$(date +%s)
  while true; do
    if output=$("${COMPOSE[@]}" exec -T worker node dist/healthcheck.cjs --mode=ready 2>&1); then
      printf '%s\n' "$output"
      return 0
    fi
    current_at=$(date +%s)
    elapsed=$((current_at - started_at))
    if [ "$elapsed" -ge "$WAIT_TIMEOUT_SECONDS" ]; then
      log_error "Worker did not become READY within ${WAIT_TIMEOUT_SECONDS}s."
      printf '%s\n' "$output" >&2
      return 1
    fi
    sleep "$READY_POLL_SECONDS"
  done
}

on_error() {
  local exit_code=$?
  trap - ERR
  log_error "Production update failed during phase: $UPDATE_PHASE"
  if [ "$SCHEDULER_STOPPED" = true ]; then
    log_warn "Scheduler remains stopped to prevent new work until the failure is reviewed."
  fi
  if [ "${COMPOSE+x}" = x ]; then
    "${COMPOSE[@]}" ps || true
  fi
  exit "$exit_code"
}

trap on_error ERR

while [ "$#" -gt 0 ]; do
  case "$1" in
    --force)
      FORCE=true
      shift
      ;;
    --no-pull)
      PULL_IMAGES=false
      shift
      ;;
    --compose-file)
      if [ "$#" -lt 2 ]; then
        log_error "--compose-file requires a path"
        exit 1
      fi
      COMPOSE_FILE="$2"
      shift 2
      ;;
    --env-file)
      if [ "$#" -lt 2 ]; then
        log_error "--env-file requires a path"
        exit 1
      fi
      ENV_FILE="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      log_error "Unknown option: $1"
      usage >&2
      exit 1
      ;;
  esac
done

require_command docker
require_command grep
require_command tr
require_command date
require_command sleep
require_positive_integer "PIXISHELF_UPDATE_WAIT_TIMEOUT_SECONDS" "$WAIT_TIMEOUT_SECONDS"
require_positive_integer "PIXISHELF_UPDATE_READY_POLL_SECONDS" "$READY_POLL_SECONDS"

if [ -n "$PRE_UPDATE_HOOK" ] && [ ! -x "$PRE_UPDATE_HOOK" ]; then
  log_error "PIXISHELF_PRE_UPDATE_HOOK is not executable: $PRE_UPDATE_HOOK"
  exit 1
fi

if [ -n "$COMPOSE_FILE" ]; then
  COMPOSE_FILE=$(resolve_existing_file "$COMPOSE_FILE")
else
  COMPOSE_FILE=$(detect_compose_file)
fi

COMPOSE_DIRECTORY=$(cd -- "$(dirname -- "$COMPOSE_FILE")" && pwd)
if [ -n "$ENV_FILE" ]; then
  ENV_FILE=$(resolve_existing_file "$ENV_FILE")
elif [ -f "$COMPOSE_DIRECTORY/.env" ]; then
  ENV_FILE="$COMPOSE_DIRECTORY/.env"
else
  log_error "No Compose environment file found beside $COMPOSE_FILE. Use --env-file or PIXISHELF_ENV_FILE."
  exit 1
fi

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

"${COMPOSE[@]}" version >/dev/null
for required_service in postgres app worker; do
  if ! service_exists "$required_service"; then
    log_error "Required service is missing from Compose: $required_service"
    exit 1
  fi
done

if service_exists scheduler && service_is_running scheduler; then
  SCHEDULER_WAS_RUNNING=true
fi

log_info "Compose file: $COMPOSE_FILE"
log_info "Environment file: $ENV_FILE"

EXECUTING_JOBS=$(executing_job_count)
if [ "$EXECUTING_JOBS" -gt 0 ] && [ "$FORCE" = false ]; then
  abort_for_executing_jobs "$EXECUTING_JOBS"
fi
if [ "$EXECUTING_JOBS" -gt 0 ]; then
  log_warn "--force accepted: $EXECUTING_JOBS executing job(s) will be interrupted through the Worker drain path."
fi

if [ "$PULL_IMAGES" = true ]; then
  UPDATE_PHASE="pull-images"
  log_info "Pulling App and Worker images before the downtime window..."
  "${COMPOSE[@]}" pull app worker
else
  log_warn "--no-pull accepted: using images already present on this host."
fi

if [ "$SCHEDULER_WAS_RUNNING" = true ]; then
  UPDATE_PHASE="stop-scheduler"
  log_info "Stopping scheduler..."
  "${COMPOSE[@]}" stop scheduler
  SCHEDULER_STOPPED=true
fi

# Recheck after image pulling closes the normal scheduler race before writers stop.
EXECUTING_JOBS=$(executing_job_count)
if [ "$EXECUTING_JOBS" -gt 0 ] && [ "$FORCE" = false ]; then
  abort_for_executing_jobs "$EXECUTING_JOBS"
fi

UPDATE_PHASE="stop-writers"
log_info "Stopping App and Worker..."
"${COMPOSE[@]}" stop app worker

if [ -n "$PRE_UPDATE_HOOK" ]; then
  UPDATE_PHASE="pre-update-hook"
  log_info "Running the configured backup/checkpoint hook..."
  "$PRE_UPDATE_HOOK"
else
  log_warn "No PIXISHELF_PRE_UPDATE_HOOK is configured. This script does not create the required database/media checkpoint."
fi

UPDATE_PHASE="start-app"
log_info "Starting App first so prisma migrate deploy completes before Worker startup..."
"${COMPOSE[@]}" up -d --force-recreate --wait --wait-timeout "$WAIT_TIMEOUT_SECONDS" app

UPDATE_PHASE="start-worker"
log_info "Starting the general Worker..."
"${COMPOSE[@]}" up -d --force-recreate --wait --wait-timeout "$WAIT_TIMEOUT_SECONDS" worker

UPDATE_PHASE="worker-ready"
log_info "Waiting for Worker READY state..."
wait_for_worker_ready

UPDATE_PHASE="capability-audit"
log_info "Verifying Worker capabilities..."
"${COMPOSE[@]}" exec -T worker node dist/capability-audit.cjs

if [ "$SCHEDULER_WAS_RUNNING" = true ]; then
  UPDATE_PHASE="restore-scheduler"
  log_info "Restoring scheduler..."
  "${COMPOSE[@]}" up -d scheduler
  SCHEDULER_STOPPED=false
fi

UPDATE_PHASE="final-verification"
log_info "Updated image inventory:"
"${COMPOSE[@]}" images app worker
log_info "Final service state:"
"${COMPOSE[@]}" ps
log_info "Recent App and Worker logs:"
"${COMPOSE[@]}" logs --tail=100 app worker

trap - ERR
log_info "PixiShelf production update completed successfully."
