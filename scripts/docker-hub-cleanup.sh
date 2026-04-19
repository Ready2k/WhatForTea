#!/bin/bash

# Configuration
USERNAME="ready2k"
# Generate an Access Token in Docker Hub Account Settings -> Security
PASSWORD="YOUR_DOCKER_HUB_ACCESS_TOKEN" 
REPOS=("whatsfortea-api" "whatsfortea-frontend")
KEEP_LATEST=5

echo "Authenticating with Docker Hub..."
TOKEN=$(curl -s -H "Content-Type: application/json" -X POST -d '{"username": "'${USERNAME}'", "password": "'${PASSWORD}'"}' https://hub.docker.com/v2/users/login/ | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
    echo "❌ Authentication failed. Please check your credentials."
    exit 1
fi

for REPO in "${REPOS[@]}"; do
    echo "========================================="
    echo "📦 Trimming repository: $USERNAME/$REPO"
    
    # Get all tags sorted by last updated (newest first)
    # We filter out 'latest' to avoid deleting it
    TAGS=$(curl -s -H "Authorization: JWT ${TOKEN}" "https://hub.docker.com/v2/repositories/${USERNAME}/${REPO}/tags/?page_size=100" | grep -o '"name":"[^"]*' | cut -d'"' -f4 | grep -v 'latest')
    
    TAG_COUNT=$(echo "$TAGS" | wc -w)
    
    if [ "$TAG_COUNT" -le "$KEEP_LATEST" ]; then
        echo "✅ Only $TAG_COUNT tags found. Skipping cleanup."
        continue
    fi
    
    # Identify the tags to delete
    TAGS_TO_DELETE=$(echo "$TAGS" | tail -n +$((KEEP_LATEST + 1)))
    
    for TAG in $TAGS_TO_DELETE; do
        echo "🗑️ Deleting tag: $TAG..."
        curl -s -X DELETE -H "Authorization: JWT ${TOKEN}" "https://hub.docker.com/v2/repositories/${USERNAME}/${REPO}/tags/${TAG}/"
        echo "✅ Deleted."
    done
done

echo "🎉 Cleanup complete!"
