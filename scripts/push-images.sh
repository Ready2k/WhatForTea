#!/bin/bash
set -euo pipefail

# Build and push cross-platform (linux/amd64) images to Docker Hub.
#
# Usage:
#   ./scripts/push-images.sh              # development images
#   ./scripts/push-images.sh --prod       # production images
#   ./scripts/push-images.sh --prod --version 1.2.0
#   ./scripts/push-images.sh --no-cache
#   ./scripts/push-images.sh --api        # single service
#   ./scripts/push-images.sh --frontend   # single service
#
# Why buildx?
#   Dev machines are Apple Silicon (arm64). The Synology NAS target is
#   linux/amd64. Using `docker buildx` with a docker-container driver builds
#   natively in a BuildKit container — no slow QEMU, no broken native modules.
#
# Prerequisites:
#   docker buildx version >= 0.9
#   docker login (logged in as ready2k)

REGISTRY_USER="ready2k"
BUILD_TARGET="development"
NO_CACHE_FLAG=""
VERSION="latest"
PLATFORM="linux/amd64"
BUILDER_NAME="whatsfortea-builder"
SERVICES=()

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --prod)      BUILD_TARGET="production" ;;
        --no-cache)  NO_CACHE_FLAG="--no-cache" ;;
        --version)   VERSION="$2"; shift ;;
        --api)       SERVICES+=("api") ;;
        --frontend)  SERVICES+=("frontend") ;;
        *) echo "❌ Unknown argument: $1"; exit 1 ;;
    esac
    shift
done

if [[ ${#SERVICES[@]} -eq 0 ]]; then
    SERVICES=("api" "frontend")
fi

echo "======================================================"
echo "  WhatsForTea — cross-platform image builder"
echo "======================================================"
echo "  Platform : ${PLATFORM}"
echo "  Target   : ${BUILD_TARGET}"
echo "  Tag      : ${VERSION}"
echo "  Services : ${SERVICES[*]}"
echo "  No-cache : ${NO_CACHE_FLAG:-off}"
echo "======================================================"
echo ""

if ! command -v docker &>/dev/null; then
    echo "❌ docker not found."
    exit 1
fi

if ! docker info &>/dev/null; then
    echo "❌ Docker daemon is not running."
    exit 1
fi

if [[ ! -d "backend" || ! -d "frontend" ]]; then
    echo "❌ Run this script from the WhatsForTea/ root directory."
    exit 1
fi

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

build_and_push() {
    local service="$1"
    local dockerfile="$2"
    local context="$3"
    local image="${REGISTRY_USER}/whatsfortea-${service}"

    echo "📦 Building: ${service}"
    echo "   Image  : ${image}:${VERSION}"

    local build_sha
    build_sha="$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"

    local args=(
        docker buildx build
        --platform "${PLATFORM}"
        --file "${dockerfile}"
        --target "${BUILD_TARGET}"
        --tag "${image}:${VERSION}"
        --build-arg "BUILD_SHA=${build_sha}"
        --build-arg "RELEASE_ID=${VERSION}"
        --build-arg "NEXT_PUBLIC_RELEASE_ID=${VERSION}"
        --push
    )

    [[ -n "${NO_CACHE_FLAG}" ]] && args+=("${NO_CACHE_FLAG}")

    if [[ "${VERSION}" != "latest" ]]; then
        args+=(--tag "${image}:latest")
    fi

    args+=("${context}")
    "${args[@]}"

    echo "✅ ${service} → ${image}:${VERSION}"
    echo ""
}

for service in "${SERVICES[@]}"; do
    case $service in
        api)      build_and_push "api"      "backend/Dockerfile"  "./backend" ;;
        frontend) build_and_push "frontend" "frontend/Dockerfile" "./frontend" ;;
        *) echo "❌ Unknown service: $service"; exit 1 ;;
    esac
done

echo "======================================================"
echo "  🎉  All images built and pushed to Docker Hub"
echo "======================================================"
echo ""
echo "Deploy on Synology NAS (192.168.4.2):"
echo "  docker-compose -f docker-compose.synology.yml pull"
echo "  docker-compose -f docker-compose.synology.yml up -d"
echo ""
