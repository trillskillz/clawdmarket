#!/bin/bash
# Run this if main ever loses features again
# Usage: bash scripts/fix-branch.sh

echo "Fixing ClawdMarket main branch..."

git fetch origin

# Check if redesign-sections-1-5 still exists remotely
if git ls-remote --heads origin redesign-sections-1-5 | grep -q redesign; then
 echo "Found origin/redesign-sections-1-5 -- merging..."
 git checkout main
 git merge origin/redesign-sections-1-5 --no-ff \
 -m "fix: restore features from redesign-sections-1-5"
 echo "Merged. Run: bash scripts/predeploy-check.sh"
else
 echo "Branch not found remotely."
 echo "Check git log for last known good commit:"
 git log --oneline | head -20
 echo ""
 echo "Find the commit with all features and run:"
 echo " git reset --hard <commit-hash>"
fi
