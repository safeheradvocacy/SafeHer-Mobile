import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { EmptyState, PageHeader, StatusBadge } from '../../components/ui';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';
import type { ChatMessage, ExpertSupportRequest } from '../../types/database.types';

type Tab = 'waiting' | 'active' | 'closed';

// A support_expert's entire scope: the requests explicitly assigned to
// them (RLS: assigned_expert_id = current_profile_id()) and the messages
// inside those conversations. They never see the queue, other experts'
// conversations, or any case/shelter/user management surface.
export function SupportExpertDashboard() {
  const { profile } = useAuth();
  const [requests, setRequests] = useState<ExpertSupportRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('waiting');
  const [selected, setSelected] = useState<ExpertSupportRequest | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [closing, setClosing] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (isRefresh: boolean = false) => {
    if (!profile) return;
    if (isRefresh) setRefreshing(true);
    const { data } = await supabase
      .from('expert_support_requests')
      .select('*')
      .eq('assigned_expert_id', profile.profile_id)
      .order('requested_at', { ascending: false });
    setRequests(data ?? []);
    setLoading(false);
    setRefreshing(false);
    setLastUpdated(Date.now());
  }, [profile]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('support-expert-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expert_support_requests' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  // Realtime (above) drives instant updates; this 60s poll is purely a
  // fallback sync in case a websocket event is ever missed/dropped.
  useAutoRefresh(() => load(true));

  // Keep the open conversation's own row (status, etc.) fresh too — e.g.
  // if it gets closed from elsewhere.
  useEffect(() => {
    if (!selected) return;
    const updated = requests.find((r) => r.request_id === selected.request_id);
    if (updated) setSelected(updated);
  }, [requests, selected]);

  const openConversation = async (r: ExpertSupportRequest) => {
    setSelected(r);
    setMessagesLoading(true);
    const { data } = await supabase.from('chat_messages').select('*').eq('session_id', r.conversation_id).order('created_at', { ascending: true });
    setMessages(data ?? []);
    setMessagesLoading(false);
    setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }), 100);
  };

  // Narrowly scoped to the one open conversation — never a blanket
  // subscription across all messages. Cleaned up on unmount/selection
  // change so switching conversations never leaves a duplicate listener.
  useEffect(() => {
    if (!selected) return;
    const channel = supabase
      .channel(`support-conversation-${selected.conversation_id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `session_id=eq.${selected.conversation_id}` },
        (payload) => {
          const msg = payload.new as ChatMessage;
          setMessages((prev) => (prev.some((m) => m.message_id === msg.message_id) ? prev : [...prev, msg]));
          setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }), 50);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [selected?.conversation_id]);

  const accept = async () => {
    if (!selected) return;
    setAccepting(true);
    await supabase.from('expert_support_requests').update({ status: 'EXPERT_ACTIVE' }).eq('request_id', selected.request_id);
    setAccepting(false);
  };

  const closeConversation = async () => {
    if (!selected) return;
    setClosing(true);
    await supabase.from('expert_support_requests').update({ status: 'CLOSED' }).eq('request_id', selected.request_id);
    setClosing(false);
    setSelected(null);
  };

  const send = async () => {
    if (!input.trim() || !selected || !profile) return;
    const text = input.trim();
    setInput('');
    setSending(true);
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({ session_id: selected.conversation_id, sender_type: 'Expert', sender_profile_id: profile.profile_id, message: text })
      .select()
      .single();
    setSending(false);
    if (!error && data) {
      setMessages((prev) => [...prev, data]);
      setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }), 50);
    }
  };

  const grouped = {
    waiting: requests.filter((r) => r.status === 'EXPERT_ASSIGNED'),
    active: requests.filter((r) => r.status === 'EXPERT_ACTIVE'),
    closed: requests.filter((r) => r.status === 'CLOSED'),
  };

  const senderLabel = (m: ChatMessage) => {
    if (m.sender_type === 'User') return 'Survivor';
    if (m.sender_type === 'AI') return 'SafeSpace AI';
    if (m.sender_type === 'System') return 'SafeSpace';
    return m.sender_profile_id === profile?.profile_id ? 'You' : 'Support Expert';
  };

  return (
    <div>
      <PageHeader
        title="My Support Conversations"
        subtitle="Confidential — visible only to you and each survivor"
        actions={<DashboardHeaderActions lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => load(true)} />}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 20, alignItems: 'start' }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)' }}>
            {(['waiting', 'active', 'closed'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="btn"
                style={{
                  flex: 1,
                  borderRadius: 0,
                  background: tab === t ? 'var(--color-surface-muted)' : 'transparent',
                  fontWeight: tab === t ? 600 : 400,
                  textTransform: 'capitalize',
                }}
              >
                {t} ({grouped[t].length})
              </button>
            ))}
          </div>
          <div style={{ maxHeight: 560, overflowY: 'auto' }}>
            {loading ? (
              <p style={{ padding: 16, color: 'var(--color-text-muted)' }}>Loading...</p>
            ) : grouped[tab].length === 0 ? (
              <div style={{ padding: 16 }}>
                <EmptyState title="Nothing here" />
              </div>
            ) : (
              grouped[tab].map((r) => (
                <button
                  key={r.request_id}
                  onClick={() => openConversation(r)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 16px',
                    border: 'none',
                    borderBottom: '1px solid var(--color-border)',
                    background: selected?.request_id === r.request_id ? 'var(--color-surface-muted)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>#{r.request_id.slice(0, 8).toUpperCase()}</span>
                    <StatusBadge label={r.priority} />
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{new Date(r.requested_at).toLocaleString()}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="card" style={{ padding: 0, minHeight: 560, display: 'flex', flexDirection: 'column' }}>
          {!selected ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <EmptyState title="Select a conversation" subtitle="Choose a request from the list to view it." />
            </div>
          ) : (
            <>
              <div
                style={{
                  padding: '14px 20px',
                  borderBottom: '1px solid var(--color-border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <strong>#{selected.request_id.slice(0, 8).toUpperCase()}</strong>
                  <span style={{ marginLeft: 10 }}>
                    <StatusBadge label={selected.status.replace(/_/g, ' ')} />
                  </span>
                  {selected.reason && <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>{selected.reason}</p>}
                </div>
                {selected.status === 'EXPERT_ASSIGNED' && (
                  <button className="btn btn-primary btn-sm" onClick={accept} disabled={accepting}>
                    {accepting ? 'Accepting...' : 'Accept conversation'}
                  </button>
                )}
                {selected.status === 'EXPERT_ACTIVE' && (
                  <button className="btn btn-outline btn-sm" onClick={closeConversation} disabled={closing}>
                    {closing ? 'Closing...' : 'Close conversation'}
                  </button>
                )}
              </div>

              <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {messagesLoading ? (
                  <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
                ) : messages.length === 0 ? (
                  <EmptyState title="No messages yet" />
                ) : (
                  messages.map((m) => {
                    const isMine = m.sender_type === 'Expert' && m.sender_profile_id === profile?.profile_id;
                    const isSystem = m.sender_type === 'System';
                    return (
                      <div key={m.message_id} style={{ display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start' }}>
                        <div
                          style={{
                            maxWidth: '70%',
                            padding: '8px 12px',
                            borderRadius: 12,
                            background: isMine ? 'var(--color-primary)' : isSystem ? 'var(--color-warning-tint, #FBEBD5)' : 'var(--color-surface-muted)',
                            color: isMine ? '#fff' : 'var(--color-text)',
                          }}
                        >
                          {!isMine && <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>{senderLabel(m)}</div>}
                          <div style={{ fontSize: 14 }}>{m.message}</div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {selected.status === 'EXPERT_ACTIVE' ? (
                <div style={{ padding: 16, borderTop: '1px solid var(--color-border)', display: 'flex', gap: 10 }}>
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    placeholder="Type your message..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && send()}
                    disabled={sending}
                  />
                  <button className="btn btn-primary" onClick={send} disabled={sending || !input.trim()}>
                    Send
                  </button>
                </div>
              ) : (
                <div style={{ padding: 16, borderTop: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontSize: 13, textAlign: 'center' }}>
                  {selected.status === 'EXPERT_ASSIGNED' ? 'Accept this conversation to start messaging.' : 'This conversation is closed.'}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
