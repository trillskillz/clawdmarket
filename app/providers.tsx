"use client";

import { WalletProviders } from "@/components/WalletProviders";
import { ToastProvider } from "@/components/Toast";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WalletProviders>
      <ToastProvider>{children}</ToastProvider>
    </WalletProviders>
  );
}
