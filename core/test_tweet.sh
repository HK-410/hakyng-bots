#!/bin/bash

# Change to the script's directory to ensure .env is found correctly
cd "$(dirname "$0")"

# Load environment variables from .env file
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
else
  echo "Error: .env file not found."
  echo "Please create a .env file in the 'core' directory with your CRON_SECRET."
  exit 1
fi

# Check if CRON_SECRET is set
if [ -z "$CRON_SECRET" ]; then
  echo "Error: CRON_SECRET is not set in your .env file."
  exit 1
fi

BASE_URL="http://localhost:3000"

echo "--- Running Midnight Job (nanal) in Tweet Mode ---"
curl -s -H "Authorization: Bearer $CRON_SECRET" "$BASE_URL/api/cron/midnight"
echo -e "\n\n--------------------------------------------------\n"

echo "--- Running Morning Job (weatherfairy & githyung) in Tweet Mode ---"
curl -s -H "Authorization: Bearer $CRON_SECRET" "$BASE_URL/api/cron/morning"
echo -e "\n"

echo "--- Test complete ---"
