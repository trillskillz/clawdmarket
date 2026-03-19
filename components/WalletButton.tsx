"use client"

import { useMemo, useState } from 'react'
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi'

function truncateAddress(address?: string) {
  if (!address) return ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export default function WalletButton() {
  const { address, chain, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()
  const { chains, switchChain } = useSwitchChain()
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState(false)

  const label = useMemo(() => truncateAddress(address), [address])

  if (!isConnected) {
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg border border-accent px-4 py-2 text-sm font-semibold text-accent hover:bg-accent-dim"
        >
          Connect Wallet
        </button>

        {open && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
            <div className="w-full max-w-sm rounded-xl border border-border bg-bg-card p-4" onClick={(e) => e.stopPropagation()}>
              <h3 className="mb-3 text-lg font-semibold text-text">Connect Wallet</h3>
              <div className="space-y-2">
                {connectors.map((connector) => (
                  <button
                    key={connector.uid}
                    onClick={() => {
                      connect({ connector })
                      setOpen(false)
                    }}
                    className="w-full rounded-lg border border-border px-3 py-2 text-left text-sm text-text hover:border-accent"
                  >
                    {connector.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setMenu((v) => !v)}
        className="rounded-lg border border-accent px-4 py-2 text-sm font-semibold text-text"
      >
        ⛓ {label}
      </button>
      {menu && (
        <div className="absolute right-0 z-50 mt-2 w-52 rounded-lg border border-border bg-bg-card p-2 text-sm">
          <button
            onClick={() => {
              navigator.clipboard.writeText(address || '')
              setMenu(false)
            }}
            className="block w-full rounded px-2 py-2 text-left text-text-dim hover:bg-bg-card-hover hover:text-text"
          >
            Copy Address
          </button>
          <div className="my-1 border-t border-border" />
          {chains.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                switchChain({ chainId: c.id })
                setMenu(false)
              }}
              className={`block w-full rounded px-2 py-2 text-left hover:bg-bg-card-hover ${chain?.id === c.id ? 'text-accent' : 'text-text-dim hover:text-text'}`}
            >
              {c.name}
            </button>
          ))}
          <div className="my-1 border-t border-border" />
          <button
            onClick={() => {
              disconnect()
              setMenu(false)
            }}
            className="block w-full rounded px-2 py-2 text-left text-text-dim hover:bg-bg-card-hover hover:text-text"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  )
}
