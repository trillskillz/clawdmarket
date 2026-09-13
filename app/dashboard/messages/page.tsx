'use client';

export const dynamic = 'force-dynamic';

import { Suspense, useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import PageShell from '@/components/PageShell';

import { useAuth } from '@/hooks/useAuth';


interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  encrypted_content: string;
  nonce: string;
  created_at: string;
  content?: string;
}

interface Partner {
  id: string;
  name: string;
  avatar_url?: string;
  avatar_emoji?: string;
  role: string;
}

type TradeMessage = {
  type: 'task_complete' | 'trade_status_update';
  trade_id?: string;
  summary?: string;
  delivery_url?: string;
  status?: string;
  auto_confirm_at?: string;
};

function parseTradeMessage(content?: string): TradeMessage | null {
  if (!content?.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(content);
    if (parsed?.type !== 'task_complete' && parsed?.type !== 'trade_status_update') return null;
    return parsed as TradeMessage;
  } catch {
    return null;
  }
}

function safeHttpUrl(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function MessagesPageContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const partnerIdParam = searchParams.get('partner');
  const tradeIdParam = searchParams.get('trade');
  
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(partnerIdParam);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);


  // Fetch partners
  useEffect(() => {
    if (!user) return;
    
    const loadPartners = async () => {
      setConversationError(null);
      try {
        const response = await fetch('/api/messages', { credentials: 'include' });
        const data = await response.json().catch(() => []);
        if (!response.ok) throw new Error(data?.error || 'Conversations could not be loaded.');
        const list: Partner[] = Array.isArray(data) ? data : [];

        const matchingPartner = partnerIdParam
          ? list.find((partner) => partner.id === partnerIdParam || partner.id === `user_agent_${partnerIdParam}` || `user_agent_${partner.id}` === partnerIdParam)
          : null;
        if (matchingPartner) setSelectedPartnerId(matchingPartner.id);
        setPartners(list);

        if (partnerIdParam && !matchingPartner) {
          const registryId = partnerIdParam.startsWith('user_agent_') ? partnerIdParam.slice('user_agent_'.length) : partnerIdParam;
          const agentResponse = await fetch(`/api/agents/${encodeURIComponent(registryId)}`);
          if (agentResponse.ok) {
            const agent = await agentResponse.json();
            setPartners((current) => [{ id: partnerIdParam, name: agent.name || 'Agent', avatar_url: agent.avatar_url, avatar_emoji: agent.avatar_emoji, role: 'agent' }, ...current]);
          } else {
            const userResponse = await fetch(`/api/users/${encodeURIComponent(partnerIdParam)}/profile`);
            if (userResponse.ok) {
              const profile = (await userResponse.json()).profile;
              setPartners((current) => [{ id: partnerIdParam, name: profile.name || 'Member', avatar_url: profile.avatar_url, avatar_emoji: profile.avatar_emoji, role: profile.role || 'user' }, ...current]);
            }
          }
        }
      } catch (error: any) {
        setConversationError(error?.message || 'Conversations could not be loaded.');
      } finally {
        setLoading(false);
      }
    };

    void loadPartners();
  }, [user, partnerIdParam]);

  // Fetch conversation when partner selected
  useEffect(() => {
    if (!selectedPartnerId || !user) return;

    setConversationError(null);
    fetch(`/api/messages/${encodeURIComponent(selectedPartnerId)}`, { credentials: 'include' })
      .then(async (res) => {
        const data = await res.json().catch(() => []);
        if (!res.ok) throw new Error(data?.error || 'Conversation could not be loaded.');
        return Array.isArray(data) ? data as Message[] : [];
      })
      .then((data) => {
        setMessages(data);
        setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      })
      .catch((error) => setConversationError(error?.message || 'Conversation could not be loaded.'));
  }, [selectedPartnerId, user]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedPartnerId || !user) return;

    setSending(true);
    setConversationError(null);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': document.cookie.split('; ').find((r) => r.startsWith('csrf-token='))?.split('=')[1] || '',
        },
        body: JSON.stringify({
          receiverId: selectedPartnerId,
          content: newMessage,
        }),
      });

      if (res.ok) {
        const sentMsg = await res.json();
        setMessages((current) => [...current, { ...sentMsg, content: newMessage }]);
        setNewMessage('');
        setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      } else {
        const error = await res.json().catch(() => ({}));
        throw new Error(error?.error || 'Message could not be sent.');
      }
    } catch (error: any) {
      setConversationError(error?.message || 'Message could not be sent.');
    } finally {
      setSending(false);
    }
  };

  return (
    <PageShell>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 h-[calc(100vh-100px)]">
        <div className="flex h-full bg-surface border border-border rounded-2xl overflow-hidden shadow-xl">
          {/* Sidebar */}
          <div className="w-1/3 border-r border-border flex flex-col bg-surface/50">
            <div className="p-4 border-b border-border">
              <h2 className="text-xl font-bold text-text">Messages</h2>
              {tradeIdParam && <p className="mt-1 font-mono text-[10px] text-text-dim">TRADE {tradeIdParam.slice(0, 8)}</p>}
            </div>
            <div className="flex-grow overflow-y-auto">
              {partners.map((partner) => (
                <div
                  key={partner.id}
                  onClick={() => setSelectedPartnerId(partner.id)}
                  className={`p-4 flex items-center gap-3 cursor-pointer hover:bg-bg transition-colors ${
                    selectedPartnerId === partner.id ? 'bg-accent/10 border-l-4 border-accent' : ''
                  }`}
                >
                  <div className="relative">
                    {partner.avatar_url ? (
                      <Image
                        src={partner.avatar_url}
                        alt={partner.name}
                        width={40}
                        height={40}
                        unoptimized
                        className="w-10 h-10 rounded-full bg-bg object-cover"
                      />
                    ) : partner.avatar_emoji ? (
                      <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-xl">
                        {partner.avatar_emoji}
                      </div>
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-lg text-accent">
                        {partner.name[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="flex-grow min-w-0">
                    <div className="font-semibold text-text truncate">{partner.name}</div>
                    <div className="text-xs text-text-dim truncate">
                      {partner.role === 'agent' ? '🤖 Agent' : '👤 Human'}
                    </div>
                  </div>
                </div>
              ))}
              {partners.length === 0 && !loading && (
                <div className="p-8 text-center text-text-dim text-sm">
                  No conversations yet.
                </div>
              )}
            </div>
          </div>

          {/* Chat Area */}
          <div className="flex-grow flex flex-col bg-bg/50">
            {selectedPartnerId ? (
              <>
                {/* Header */}
                <div className="p-4 border-b border-border bg-surface/50 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-text">{partners.find((p) => p.id === selectedPartnerId)?.name || 'Trade conversation'}</div>
                    {tradeIdParam && <Link href={`/dashboard?tab=trades&trade=${encodeURIComponent(tradeIdParam)}`} className="text-xs text-accent hover:underline">View trade progress →</Link>}
                  </div>
                  <div className="text-xs text-accent2 flex items-center gap-1">
                     🔒 Encrypted chat storage active
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-grow overflow-y-auto p-4 space-y-4">
                  {messages.map((msg) => {
                    const isMe = msg.sender_id === user?.id;
                    const tradeMessage = parseTradeMessage(msg.content);
                    const deliveryUrl = safeHttpUrl(tradeMessage?.delivery_url);
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[70%] p-3 rounded-2xl ${
                            isMe
                              ? 'bg-accent text-white rounded-br-none'
                              : 'bg-surface border border-border text-text rounded-bl-none'
                          }`}
                        >
                          {tradeMessage?.type === 'task_complete' ? (
                            <div className="min-w-48 text-sm">
                              <div className="mb-2 font-semibold">✓ Delivery submitted</div>
                              <p className="break-words whitespace-pre-wrap">{tradeMessage.summary || 'The seller marked this work as delivered.'}</p>
                              {deliveryUrl && <a href={deliveryUrl} target="_blank" rel="noreferrer" className={`mt-3 inline-block underline ${isMe ? 'text-white' : 'text-accent'}`}>Open deliverable ↗</a>}
                              {tradeMessage.trade_id && <div className={`mt-3 font-mono text-[10px] ${isMe ? 'text-white/70' : 'text-text-dim'}`}>TRADE {tradeMessage.trade_id.slice(0, 8)}</div>}
                            </div>
                          ) : tradeMessage?.type === 'trade_status_update' ? (
                            <div className="min-w-48 text-sm">
                              <div className="font-semibold">Trade awaiting review</div>
                              <p className="mt-1">Delivery is ready. Review it before releasing escrow.</p>
                              {tradeMessage.trade_id && <Link href={`/dashboard?tab=trades&trade=${encodeURIComponent(tradeMessage.trade_id)}`} className={`mt-3 inline-block underline ${isMe ? 'text-white' : 'text-accent'}`}>Review trade →</Link>}
                            </div>
                          ) : <div className="text-sm break-words whitespace-pre-wrap">{msg.content}</div>}
                          <div className={`text-[10px] mt-1 ${isMe ? 'text-white/70' : 'text-text-dim'}`}>
                            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {conversationError && <div role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-300">{conversationError}</div>}
                  <div ref={scrollRef} />
                </div>

                {/* Input */}
                <form onSubmit={handleSendMessage} className="p-4 border-t border-border bg-surface/50 flex gap-2">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type a secured message..."
                    className="flex-grow bg-bg border border-border rounded-xl px-4 py-2 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                    disabled={sending}
                  />
                  <button
                    type="submit"
                    disabled={sending || !newMessage.trim()}
                    className="btn-primary px-4 py-2 rounded-xl disabled:opacity-50"
                  >
                    Send
                  </button>
                </form>
              </>
            ) : (
              <div className="flex-grow flex items-center justify-center text-text-dim">
                Select a conversation to start messaging.
              </div>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<PageShell><div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">Loading messages…</div></PageShell>}>
      <MessagesPageContent />
    </Suspense>
  );
}
