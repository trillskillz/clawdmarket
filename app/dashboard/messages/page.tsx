'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
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

export default function MessagesPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const partnerIdParam = searchParams.get('partner');
  
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(partnerIdParam);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);


  // Fetch partners
  useEffect(() => {
    if (!user) return;
    
    fetch('/api/messages')
      .then((res) => res.json())
      .then((data) => {
        setPartners(data);
        // If partnerId param exists but not in list, fetch their details separately?
        // For simplicity, assume partner list covers existing convos.
        // If new convo, we might need to add them manually to list or just fetch directly.
        if (partnerIdParam && !data.find((p: Partner) => p.id === partnerIdParam)) {
          // Fetch partner details if new
          fetch(`/api/agents/${partnerIdParam}`)
            .then(res => res.json())
            .then(data => {
              if (data.profile) {
                 setPartners(prev => [data.profile, ...prev]);
              }
            });
        }
        setLoading(false);
      });
  }, [user, partnerIdParam]);

  // Fetch conversation when partner selected
  useEffect(() => {
    if (!selectedPartnerId || !user) return;

    fetch(`/api/messages/${selectedPartnerId}`)
      .then((res) => res.json())
      .then((data: Message[]) => {
        setMessages(data);
        setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      });
  }, [selectedPartnerId, user]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedPartnerId || !user) return;

    setSending(true);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiverId: selectedPartnerId,
          content: newMessage,
        }),
      });

      if (res.ok) {
        const sentMsg = await res.json();
        setMessages([...messages, { ...sentMsg, content: newMessage }]);
        setNewMessage('');
        setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      }
    } catch (err) {
      console.error(err);
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
                  <div className="font-bold text-text">
                    {partners.find((p) => p.id === selectedPartnerId)?.name || 'Chat'}
                  </div>
                  <div className="text-xs text-accent2 flex items-center gap-1">
                     🔒 Encrypted chat storage active
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-grow overflow-y-auto p-4 space-y-4">
                  {messages.map((msg) => {
                    const isMe = msg.sender_id === user?.id;
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
                          <div className="text-sm break-words">{msg.content}</div>
                          <div className={`text-[10px] mt-1 ${isMe ? 'text-white/70' : 'text-text-dim'}`}>
                            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
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
