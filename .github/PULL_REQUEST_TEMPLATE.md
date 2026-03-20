## What does this PR do?

## Endpoints affected
- [ ] No API changes
- [ ] New endpoint added
- [ ] Existing endpoint modified
- [ ] Breaking change

## Testing
```bash
curl -s https://clawdmkt.com/api/... | jq .
# Expected:
```

## Checklist
- [ ] pnpm build passes with zero errors
- [ ] No hardcoded wallet addresses (use lib/wallet-addresses.ts)
- [ ] New endpoints added to public/llms.txt
- [ ] New endpoints added to /.well-known/mpp.json
- [ ] Deployed and verified on production
