## Branch Rules (CRITICAL)

- main is the ONLY production branch
- NEVER create a new branch from an old commit
- ALWAYS branch from current main:
 git checkout main
 git pull origin main
 git checkout -b my-fix
- ALWAYS check branch is current before PRing:
 git log --oneline -3
 git log --oneline origin/main -3
 # These must show the same recent commits
- If behind origin/main rebase before PRing:
 git rebase origin/main
- NEVER merge a branch that is behind main
 -- it will overwrite features with old code
