#!/bin/bash

# Usage: ./bump-version.sh [major|minor|patch|<new_version>]
# Default: patch

# Removed 'set -e' to prevent terminal from closing automatically

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 1. Get current version from package.json
current_version=$(grep -oP '"version":\s*"\K[0-9]+\.[0-9]+\.[0-9]+' package.json)
if [ -z "$current_version" ]; then
  print_error "Could not find current version in package.json"
  exit 1
fi

# 2. Calculate new version
bump=${1:-patch}
IFS='.' read -r major minor patch <<< "$current_version"

if [[ "$bump" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  new_version="$bump"
else
  case "$bump" in
    major)
      new_version="$((major+1)).0.0"
      ;;
    minor)
      new_version="$major.$((minor+1)).0"
      ;;
    patch|*)
      new_version="$major.$minor.$((patch+1))"
      ;;
  esac
fi

print_status "Bumping version: $current_version -> $new_version"

# 3. Update only JSON files with "version" field
json_files=(
    "package.json"
    "app-data.json" 
    "public/schema/openapi.json"
)

for file in "${json_files[@]}"; do
    if [ -f "$file" ]; then
        if sed -i "s/\"version\":\s*\"$current_version\"/\"version\": \"$new_version\"/g" "$file"; then
            print_success "Updated $file"
        else
            print_warning "Failed to update $file"
        fi
    else
        print_warning "File not found: $file"
    fi
done

# Verify the update by checking package.json
final_version=$(grep -oP '"version":\s*"\K[0-9]+\.[0-9]+\.[0-9]+' package.json)
if [ "$final_version" = "$new_version" ]; then
    print_success "Version successfully updated to $new_version in all relevant files."
else
    print_error "Version update verification failed. Expected: $new_version, Found: $final_version"
fi

echo ""
print_status "Version bump completed!"
print_status "Current version: $new_version"
echo ""
# print_status "Press Enter to exit."
# read 