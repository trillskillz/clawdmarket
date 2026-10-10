# Pinned disposable Tempo genesis

`tempo-dev-v1.16.0.json` is the unmodified official development genesis from
[Tempo v1.16.0](https://github.com/tempoxyz/tempo/blob/v1.16.0/crates/chainspec/src/genesis/dev.json),
commit `74b69155ebaf6178bf7e3d59d18a2440164302d9`.
SHA-256: `f463432cfef926a6bd557bfa59294a7cfa5e0e7420b4ac076df769dfd78670a6`.
Tempo licenses its source under [Apache-2.0 or MIT](https://github.com/tempoxyz/tempo/blob/v1.16.0/README.md#license).
The original MIT notice is preserved in `TEMPO_LICENSE_MIT.txt`.

The guarded test helper checks that hash and node version, copies the genesis to
its own temporary directory and changes only chain ID 1337 to 4217. This keeps
the application's existing production chain checks intact while using an
unforked disposable development state, canonical TIP-20 precompiles and public
dummy keys. Every development hardfork is active at genesis. This proves local
application protocol behavior, not deployed mainnet hardfork compatibility or
validator consensus independence.

The standalone node uses loopback HTTP/P2P, no discovery or bootnode endpoint,
disabled IPC and isolated database storage. Its development issuer mints test
pathUSD to the buyer/treasury. The helper kills its owned process and removes its
temporary data after each run. No hosted RPC or existing wallet is used.
