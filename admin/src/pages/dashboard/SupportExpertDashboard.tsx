import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Hourglass, Loader2, MessageCircle, MessageCircleHeart, Send } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { EmptyState, PageHeader, StatusBadge } from '../../components/ui';
import { DashboardHeaderActions, formatRelativeTime } from '../../components/dashboard/DashboardHeaderActions';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';
import type { ChatMessage, ExpertSupportRequest } from '../../types/database.types';

type Tab = 'waiting' | 'active' | 'closed';

const TAB_CONFIG: Record<Tab, { label: string; icon: React.ElementType; emptyLabel: string }> = {
  waiting: { label: 'Waiting', icon: Hourglass, emptyLabel: 'No waiting conversations' },
  active: { label: 'Active', icon: MessageCircle, emptyLabel: 'No active conversations' },
  closed: { label: 'Closed', icon: CheckCircle2, emptyLabel: 'No closed conversations' },
};

function conversationLabel(r: ExpertSupportRequest) {
  return `#${r.request_id.slice(0, 8).toUpperCase()}`;
}

// A support_expert's entire scope: the requests explicitly assigned to
// them (RLS: assigned_expert_id = current_profile_id()) and the messages
// inside those conversations. They never see the queue, other experts'
// conversations, or any case/shelter/user management surface.
export function SupportExpertDashboard() {
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
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
  // Most recent message per conversation_id — drives the list preview
  // and the "most recent activity first" sort. Fetched alongside the
  // request list itself (one bounded query: this expert's own
  // conversations only), never a parallel per-row query.
  const [lastMessages, setLastMessages] = useState<Record<string, ChatMessage>>({});
  // request_ids with an unread 'Support' notification addressed to this
  // expert (module41) — the existing notifications table IS the
  // "unread indicator" data model here; this never invents a second,
  // message-level read-tracking mechanism.
  const [unreadRequestIds, setUnreadRequestIds] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (isRefresh: boolean = false) => {
    if (!profile) return;
    if (isRefresh) setRefreshing(true);
    const { data } = await supabase
      .from('expert_support_requests')
      .select('*')
      .eq('assigned_expert_id', profile.profile_id)
      .order('requested_at', { ascending: false });
    const list = data ?? [];
    setRequests(list);
    setLoading(false);
    setRefreshing(false);
    setLastUpdated(Date.now());

    const conversationIds = list.map((r) => r.conversation_id);
    if (conversationIds.length > 0) {
      const { data: msgs } = await supabase
        .from('chat_messages')
        .select('*')
        .in('session_id', conversationIds)
        .order('created_at', { ascending: false });
      if (msgs) {
        const latest: Record<string, ChatMessage> = {};
        for (const m of msgs) {
          if (!latest[m.session_id]) latest[m.session_id] = m;
        }
        setLastMessages(latest);
      }
    } else {
      setLastMessages({});
    }
  }, [profile]);

  const loadUnread = useCallback(async () => {
    if (!profile) return;
    const { data } = await supabase
      .from('notifications')
      .select('request_id')
      .eq('profile_id', profile.profile_id)
      .eq('notification_type', 'Support')
      .eq('is_read', false)
      .not('request_id', 'is', null);
    setUnreadRequestIds(new Set((data ?? []).map((n) => n.request_id as string)));
  }, [profile]);

  useEffect(() => {
    load();
    loadUnread();
  }, [load, loadUnread]);

  // Lightweight realtime for the unread-notification dots — scoped to
  // this expert's own notifications. A NEW notification (module41: a
  // new message, an assignment/reassignment) also triggers a full
  // `load()`, since that's this dashboard's only signal that some
  // OTHER conversation's preview/order needs refreshing (the per-
  // conversation chat_messages channel above only covers the one
  // currently-open conversation). Marking one read elsewhere (e.g. the
  // header bell) only needs the lighter `loadUnread()` — no reason to
  // re-fetch the whole request list for that.
  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel('support-expert-notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `profile_id=eq.${profile.profile_id}` },
        () => {
          loadUnread();
          load();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `profile_id=eq.${profile.profile_id}` },
        () => loadUnread()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.profile_id, loadUnread, load]);

  // Realtime drives instant updates; scoped to this expert's own rows so
  // this channel never fires for every other expert's assignments, not
  // just a blanket subscription across the whole table. `hasConnectedBefore`
  // makes the resubscribe-after-a-drop case (network blip, laptop sleep,
  // Supabase Realtime server restart) resynchronize the list once the
  // socket comes back — supabase-js already auto-reconnects/resubscribes
  // the channel itself, this just fills in anything that was missed while
  // it was down, same as the 60s poll below but immediate.
  useEffect(() => {
    if (!profile) return;
    let hasConnectedBefore = false;
    const channel = supabase
      .channel('support-expert-requests')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expert_support_requests', filter: `assigned_expert_id=eq.${profile.profile_id}` },
        () => load()
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (hasConnectedBefore) load(true);
          hasConnectedBefore = true;
        }
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.profile_id, load]);

  // Realtime (above) drives instant updates; this 60s poll is purely a
  // fallback sync in case a websocket event is ever missed/dropped.
  useAutoRefresh(() => load(true));

  // Keep the open conversation's own row (status, etc.) fresh too — e.g.
  // if it gets closed from elsewhere. Preserves the selection itself (and
  // therefore the open detail panel) even if it drops out of the
  // currently-filtered tab.
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

    // Opening a conversation is the same "I've seen this" signal the
    // notification bell already treats as mark-read — clears this
    // item's unread dot and the matching notification record together,
    // rather than inventing a separate read-state for the list.
    if (unreadRequestIds.has(r.request_id)) {
      setUnreadRequestIds((prev) => {
        const next = new Set(prev);
        next.delete(r.request_id);
        return next;
      });
      supabase.from('notifications').update({ is_read: true }).eq('request_id', r.request_id).eq('is_read', false);
    }
  };

  // Deep-link from a notification (NotificationBell/NotificationsPage,
  // module41) — ?open=<request_id>. Only resolves once the expert's own
  // requests have loaded, and only ever opens a request actually in
  // their own list (RLS already guarantees that's the full set of what
  // they're allowed to see; this is just "find it locally", not a
  // separate authorization check).
  useEffect(() => {
    const openId = searchParams.get('open');
    if (!openId || loading) return;
    const match = requests.find((r) => r.request_id === openId);
    if (match) openConversation(match);
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, requests]);

  // Narrowly scoped to the one open conversation — never a blanket
  // subscription across all messages. Cleaned up on unmount/selection
  // change so switching conversations never leaves a duplicate listener.
  // Same reconnect-resync pattern as the requests channel above: refetch
  // this conversation's messages once the socket reconnects, in case an
  // INSERT event was missed while it was briefly down.
  useEffect(() => {
    if (!selected) return;
    let hasConnectedBefore = false;
    const channel = supabase
      .channel(`support-conversation-${selected.conversation_id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `session_id=eq.${selected.conversation_id}` },
        (payload) => {
          const msg = payload.new as ChatMessage;
          setMessages((prev) => (prev.some((m) => m.message_id === msg.message_id) ? prev : [...prev, msg]));
          setLastMessages((prev) => ({ ...prev, [msg.session_id]: msg }));
          setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }), 50);
        }
      )
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          if (hasConnectedBefore) {
            const { data } = await supabase
              .from('chat_messages')
              .select('*')
              .eq('session_id', selected.conversation_id)
              .order('created_at', { ascending: true });
            if (data) setMessages(data);
          }
          hasConnectedBefore = true;
        }
      });
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
      setMessages((prev) => (prev.some((m) => m.message_id === data.message_id) ? prev : [...prev, data]));
      setLastMessages((prev) => ({ ...prev, [data.session_id]: data }));
      setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }), 50);
    } else if (error) {
      // Existing error-handling convention for this page: put the draft
      // back so nothing the expert typed is silently lost on a failed send.
      setInput(text);
    }
  };

  // Most recent relevant activity first — the last message in the
  // conversation when one exists, falling back to when the request was
  // submitted (e.g. a Waiting request with no messages yet). Purely a
  // display order; never changes a request's actual status/ownership.
  const activityTime = (r: ExpertSupportRequest) => {
    const last = lastMessages[r.conversation_id];
    return last ? new Date(last.created_at).getTime() : new Date(r.requested_at).getTime();
  };
  const byRecentActivity = (a: ExpertSupportRequest, b: ExpertSupportRequest) => activityTime(b) - activityTime(a);

  const grouped = {
    waiting: requests.filter((r) => r.status === 'EXPERT_ASSIGNED').sort(byRecentActivity),
    active: requests.filter((r) => r.status === 'EXPERT_ACTIVE').sort(byRecentActivity),
    closed: requests.filter((r) => r.status === 'CLOSED').sort(byRecentActivity),
  };

  const senderLabel = (m: ChatMessage) => {
    if (m.sender_type === 'User') return 'Survivor';
    if (m.sender_type === 'AI') return 'SafeSpace AI';
    if (m.sender_type === 'System') return 'SafeSpace';
    return m.sender_profile_id === profile?.profile_id ? 'You' : 'Support Expert';
  };

  const messageTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  // List-preview text: the most recent message when one exists
  // (prefixed "You:" for the expert's own last message, matching the
  // same convention a messaging app reader would expect), otherwise
  // falls back to the existing reason-or-placeholder text so a
  // not-yet-messaged Waiting request still shows something.
  const previewText = (r: ExpertSupportRequest) => {
    const last = lastMessages[r.conversation_id];
    if (!last) return r.reason || 'No reason given';
    const mine = last.sender_type === 'Expert' && last.sender_profile_id === profile?.profile_id;
    return `${mine ? 'You: ' : ''}${last.message}`;
  };

  const CurrentTabIcon = TAB_CONFIG[tab].icon;

  return (
    <div>
      <PageHeader
        title="My Support Conversations"
        subtitle="Confidential — visible only to you and each survivor."
        actions={<DashboardHeaderActions lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => load(true)} />}
      />

      <div className="conv-layout" data-has-selection={selected ? 'true' : 'false'}>
        <div className="conv-list-panel card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="conv-tabs" role="tablist" aria-label="Conversation status">
            {(Object.keys(TAB_CONFIG) as Tab[]).map((t) => {
              const { label, icon: Icon } = TAB_CONFIG[t];
              return (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`conv-tab${tab === t ? ' active' : ''}`}
                >
                  <Icon size={14} strokeWidth={2} />
                  {label}
                  <span className="conv-tab-count">{grouped[t].length}</span>
                </button>
              );
            })}
          </div>
          <div className="conv-list">
            {loading ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                <Loader2 size={18} className="icon-spin" style={{ marginBottom: 8 }} />
                <p style={{ margin: 0, fontSize: 13 }}>Loading conversations…</p>
              </div>
            ) : grouped[tab].length === 0 ? (
              <div className="conv-category-empty">
                <div className="conv-category-empty-icon">
                  <CurrentTabIcon size={16} />
                </div>
                <p>{TAB_CONFIG[tab].emptyLabel}</p>
              </div>
            ) : (
              grouped[tab].map((r) => (
                <button
                  key={r.request_id}
                  type="button"
                  onClick={() => openConversation(r)}
                  className={`conv-list-item${selected?.request_id === r.request_id ? ' active' : ''}`}
                >
                  <div className="conv-list-item-top">
                    <span className="conv-list-item-id">
                      {unreadRequestIds.has(r.request_id) && <span className="conv-unread-dot" aria-label="Unread" />}
                      {conversationLabel(r)}
                    </span>
                    <span className="conv-list-item-time">{formatRelativeTime(activityTime(r))}</span>
                  </div>
                  <div className="conv-list-item-bottom">
                    <span className="conv-list-item-reason">{previewText(r)}</span>
                    <StatusBadge label={r.priority} />
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="conv-detail-panel card" style={{ padding: 0, minHeight: 640, display: 'flex', flexDirection: 'column' }}>
          {!selected ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <EmptyState
                icon={<MessageCircleHeart size={20} />}
                title="Select a Conversation"
                subtitle="Choose a conversation from the list to view its details."
              />
            </div>
          ) : (
            <>
              <div className="conv-detail-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <button type="button" className="conv-back-btn btn btn-outline btn-sm" onClick={() => setSelected(null)} aria-label="Back to conversation list">
                    <ArrowLeft size={14} />
                  </button>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <strong>{conversationLabel(selected)}</strong>
                      <StatusBadge label={selected.status.replace(/_/g, ' ')} />
                    </div>
                    {selected.reason && <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>{selected.reason}</p>}
                  </div>
                </div>
                {selected.status === 'EXPERT_ASSIGNED' && (
                  <button className="btn btn-primary btn-sm" onClick={accept} disabled={accepting}>
                    {accepting ? 'Accepting…' : 'Accept conversation'}
                  </button>
                )}
                {selected.status === 'EXPERT_ACTIVE' && (
                  <button className="btn btn-outline btn-sm" onClick={closeConversation} disabled={closing}>
                    {closing ? 'Closing…' : 'Close conversation'}
                  </button>
                )}
              </div>

              <div ref={listRef} className="conv-message-list">
                {messagesLoading ? (
                  <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: 24 }}>
                    <Loader2 size={18} className="icon-spin" />
                  </div>
                ) : messages.length === 0 ? (
                  <EmptyState title="No messages yet" />
                ) : (
                  messages.map((m) => {
                    const isMine = m.sender_type === 'Expert' && m.sender_profile_id === profile?.profile_id;
                    const isSystem = m.sender_type === 'System';
                    const kind = isSystem ? 'system' : isMine ? 'mine' : 'theirs';
                    return (
                      <div key={m.message_id} className={`conv-bubble-row ${kind}`}>
                        <div className={`conv-bubble ${kind}`}>
                          {!isMine && !isSystem && <div className="conv-bubble-label">{senderLabel(m)}</div>}
                          <div>{m.message}</div>
                          {!isSystem && <div className="conv-bubble-time">{messageTime(m.created_at)}</div>}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {selected.status === 'EXPERT_ACTIVE' ? (
                <div className="conv-composer">
                  <input
                    id="support-conversation-input"
                    className="input"
                    style={{ flex: 1 }}
                    placeholder="Type your message…"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && send()}
                    disabled={sending}
                  />
                  <button className="btn btn-primary" onClick={send} disabled={sending || !input.trim()} aria-label="Send message">
                    <Send size={15} />
                    Send
                  </button>
                </div>
              ) : (
                <div className="conv-status-footer">
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
