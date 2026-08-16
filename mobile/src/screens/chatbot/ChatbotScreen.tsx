import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Input, PrimaryButton } from '../../components/ui';
import { colors, radius, spacing, typography } from '../../theme/theme';
import type { ChatMessage } from '../../types/database.types';

// Offline fallback so the chatbot still answers common questions if the
// `safeher-chatbot` Edge Function (see /supabase/functions in the admin repo)
// isn't deployed yet or the AI call fails. Never a substitute for real triage.
const FAQ_FALLBACK: { match: RegExp; reply: string }[] = [
  { match: /report|incident/i, reply: 'You can submit a confidential report from Home > Report Incident. You can also report anonymously.' },
  { match: /shelter/i, reply: 'Open Shelter Locator from the Home screen to see shelters near you with contact details and capacity.' },
  { match: /sos|emergency|danger/i, reply: 'If you are in immediate danger, use the SOS button on the Home screen to send your location to a responder right now.' },
  { match: /case|status|track/i, reply: 'You can check the status of any report you\u2019ve submitted under "Track My Cases".' },
];

function fallbackReply(userText: string): string {
  const hit = FAQ_FALLBACK.find((f) => f.match.test(userText));
  return (
    hit?.reply ??
    "I can help with reporting, case status, shelters, and general SafeHer navigation. For anything urgent, please use the SOS button — I'm not a substitute for an emergency responder, legal counsel, or a social worker."
  );
}

export function ChatbotScreen() {
  const { profile } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!profile) return;
    (async () => {
      const { data: existing } = await supabase
        .from('chat_sessions')
        .select('*')
        .eq('profile_id', profile.profile_id)
        .eq('is_active', true)
        .order('started_at', { ascending: false })
        .limit(1);

      let session = existing?.[0];
      if (!session) {
        const { data: created } = await supabase
          .from('chat_sessions')
          .insert({ profile_id: profile.profile_id, is_active: true })
          .select()
          .single();
        session = created ?? undefined;
      }
      if (!session) return;
      setSessionId(session.session_id);

      const { data: msgs } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('session_id', session.session_id)
        .order('created_at', { ascending: true });
      setMessages(msgs ?? []);
    })();
  }, [profile]);

  const send = async () => {
    if (!input.trim() || !sessionId) return;
    const text = input.trim();
    setInput('');
    setSending(true);

    const { data: userMsg } = await supabase
      .from('chat_messages')
      .insert({ session_id: sessionId, sender_type: 'User', message: text })
      .select()
      .single();
    if (userMsg) setMessages((prev) => [...prev, userMsg]);

    let aiText: string;
    try {
      const { data, error } = await supabase.functions.invoke('safeher-chatbot', {
        body: { message: text, sessionId },
      });
      if (error || !data?.reply) throw error ?? new Error('empty reply');
      aiText = data.reply as string;
    } catch {
      aiText = fallbackReply(text);
    }

    const { data: aiMsg } = await supabase
      .from('chat_messages')
      .insert({ session_id: sessionId, sender_type: 'AI', message: aiText })
      .select()
      .single();
    if (aiMsg) setMessages((prev) => [...prev, aiMsg]);
    setSending(false);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>
          This assistant gives general SafeHer information. It is not a replacement for emergency responders,
          legal professionals, or social workers.
        </Text>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.message_id}
        contentContainerStyle={{ padding: spacing.lg }}
        renderItem={({ item }) => (
          <View style={[styles.bubbleRow, item.sender_type === 'User' && styles.bubbleRowUser]}>
            <View style={[styles.bubble, item.sender_type === 'User' ? styles.bubbleUser : styles.bubbleAi]}>
              <Text style={item.sender_type === 'User' ? styles.bubbleTextUser : styles.bubbleTextAi}>
                {item.message}
              </Text>
            </View>
          </View>
        )}
      />

      <View style={styles.inputRow}>
        <View style={{ flex: 1 }}>
          <Input value={input} onChangeText={setInput} placeholder="Ask SafeHer anything..." />
        </View>
        <View style={{ width: spacing.md }} />
        <PrimaryButton title="Send" onPress={send} loading={sending} disabled={!input.trim()} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  disclaimer: { backgroundColor: colors.primaryLight, padding: spacing.sm },
  disclaimerText: { ...typography.caption, color: colors.primaryDark, textAlign: 'center' },
  bubbleRow: { flexDirection: 'row', marginBottom: spacing.sm },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '80%', padding: spacing.sm, borderRadius: radius.md },
  bubbleAi: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  bubbleUser: { backgroundColor: colors.primary },
  bubbleTextAi: { ...typography.body, color: colors.text },
  bubbleTextUser: { ...typography.body, color: colors.white },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
});
