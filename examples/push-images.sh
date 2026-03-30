#!/bin/bash
set -euo pipefail

# Build and push cross-platform (linux/amd64) images to Docker Hub.
#
# Usage:
#   ./scripts/push-images.sh              # development images
#   ./scripts/push-images.sh --prod       # production images
#   ./scripts/push-images.sh --prod --version 1.2.0
#   ./scripts/push-images.sh --no-cache
#
# Why buildx?
#   Development machines are Apple Silicon (arm64). The deployment target
#   (Synology NAS / x86_64 server) is linux/amd64. Plain `docker build
#   --platform linux/amd64` on arm64 uses slow QEMU emulation and can
#   silently produce broken native modules (e.g. bcrypt, canvas).
#   `docker buildx` with a docker-container driver builds natively inside
#   a BuildKit container, ensuring correct amd64 binaries every time.
#
# Prerequisites:
#   docker buildx version >= 0.9
#   docker login (logged in to Docker Hub as ready2k)

REGISTRY_USER="ready2k"
BUILD_TARGET="development"
NO_CACHE_FLAG=""
VERSION="latest"
PLATFORM="linux/amd64"
BUILDER_NAME="mystaycation-builder"
SERVICES=()   # empty = build all

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --prod)        BUILD_TARGET="production" ;;
        --no-cache)    NO_CACHE_FLAG="--no-cache" ;;
        --version)     VERSION="$2"; shift ;;
        --api)         SERVICES+=("api") ;;
        --web)         SERVICES+=("web") ;;
        --monitoring)  SERVICES+=("monitoring") ;;
        *) echo "❌ Unknown argument: $1"; echo "Usage: $0 [--prod] [--no-cache] [--version <tag>] [--api] [--web] [--monitoring]"; exit 1 ;;
    esac
    shift
done

# Default to all services if none specified
if [[ ${#SERVICES[@]} -eq 0 ]]; then
    SERVICES=("api" "web" "monitoring")
fi

echo "======================================================"
echo "  MyStaycation — cross-platform image builder"
echo "======================================================"
echo "  Platform : ${PLATFORM}"
echo "  Target   : ${BUILD_TARGET}"
echo "  Tag      : ${VERSION}"
echo "  Services : ${SERVICES[*]}"
echo "  No-cache : ${NO_CACHE_FLAG:-off}"
echo "======================================================"
echo ""

# ── Sanity checks ─────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
    echo "❌ docker not found. Please install Docker Desktop."
    exit 1
fi

if ! docker info &>/dev/null; then
    echo "❌ Docker daemon is not running."
    exit 1
fi

# Check we are in the MyStaycation root (where backend/ web/ monitoring/ live)
if [[ ! -d "backend" || ! -d "web" || ! -d "monitoring" ]]; then
    echo "❌ Run this script from the MyStaycation/ root directory."
    exit 1
fi

# ── Ensure a buildx builder that can target linux/amd64 ──────────────────────
if ! docker buildx inspect "${BUILDER_NAME}" &>/dev/null; then
    echo "🔧 Creating buildx builder '${BUILDER_NAME}'..."
    docker buildx create \
        --name "${BUILDER_NAME}" \
        --driver docker-container \
        --bootstrap
    echo "✅ Builder created."
else
    echo "♻️  Reusing existing buildx builder '${BUILDER_NAME}'."
fi

docker buildx use "${BUILDER_NAME}"
echo ""

# ── Build helper ──────────────────────────────────────────────────────────────
# build_and_push <service> <dockerfile> <context> [<target>]
build_and_push() {
    local service="$1"
    local dockerfile="$2"
    local context="$3"
    local target="${4:-}"       # optional — monitoring has no named target
    local image="${REGISTRY_USER}/mystaycation-${service}"

    echo "📦 Building: ${service}"
    echo "   Image    : ${image}:${VERSION}"
    echo "   Context  : ${context}"
    [[ -n "${target}" ]] && echo "   Target   : ${target}"

    local build_time
    build_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    local build_sha
    build_sha="$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"

    local args=(
        docker buildx build
        --platform "${PLATFORM}"
        --file "${dockerfile}"
        --tag "${image}:${VERSION}"
        --build-arg "NEXT_PUBLIC_BUILD_TIME=${build_time}"
        --build-arg "NEXT_PUBLIC_BUILD_SHA=${build_sha}"
        --push
    )

    [[ -n "${target}" ]] && args+=(--target "${target}")
    [[ -n "${NO_CACHE_FLAG}" ]] && args+=("${NO_CACHE_FLAG}")

    # Also tag :latest when pushing a semver release
    if [[ "${VERSION}" != "latest" ]]; then
        args+=(--tag "${image}:latest")
    fi

    args+=("${context}")

    "${args[@]}"

    echo "✅ ${service} → ${image}:${VERSION}"
    echo ""
}

# ── Builds ────────────────────────────────────────────────────────────────────
for service in "${SERVICES[@]}"; do
    case $service in
        api)        build_and_push "api"        "backend/Dockerfile"    "./backend"    "${BUILD_TARGET}" ;;
        web)        build_and_push "web"        "web/Dockerfile"        "./web"        "${BUILD_TARGET}" ;;
        monitoring) build_and_push "monitoring" "monitoring/Dockerfile" "./monitoring" ;;
        *) echo "❌ Unknown service: $service"; exit 1 ;;
    esac
done

# ── Done ──────────────────────────────────────────────────────────────────────
echo "======================================================"
echo "  🎉  All images built and pushed to Docker Hub"
echo "======================================================"
echo ""
echo "Deploy on Synology / target server:"
echo "  docker-compose -f docker-compose.synology.yml pull"
echo "  docker-compose -f docker-compose.synology.yml up -d"
echo ""
