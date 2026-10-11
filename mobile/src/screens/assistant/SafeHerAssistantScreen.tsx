import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from 'react-native';
import * as Network from 'expo-network';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CompositeNavigationProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useSupportChat } from '../../lib/useSupportChat';
import { useGoToReportIncident } from '../../lib/reportIncidentGuard';
import { Input } from '../../components/ui';
import { HeaderActions } from '../../components/ScreenHeader';
import { QuickActionCard } from '../home/QuickActionCard';
import { spacing, typography, radius } from '../../theme/theme';
import { AppStackParamList, AppTabParamList } from '../../navigation/types';
import type { ChatMessage, ChatSessionStatus } from '../../types/database.types';

type Nav = CompositeNavigationProp<BottomTabNavigationProp<AppTabParamList, 'ChatTab'>, NativeStackNavigationProp<AppStackParamList>>;

// Every action the server can suggest, re-validated here — the client
// never trusts an action string it doesn't already know about, even
// though the server already filters against the same allowlist.
type ActionType = 'OPEN_INCIDENT_REPORT' | 'OPEN_CASE_TRACKING' | 'OPEN_SHELTER_LOCATOR' | 'OPEN_SHELTER_REQUEST' | 'OPEN_EMERGENCY_SOS' | 'REQUEST_EXPERT_HELP';
const KNOWN_ACTIONS: ActionType[] = [
  'OPEN_INCIDENT_REPORT',
  'OPEN_CASE_TRACKING',
  'OPEN_SHELTER_LOCATOR',
  'OPEN_SHELTER_REQUEST',
  'OPEN_EMERGENCY_SOS',
  'REQUEST_EXPERT_HELP',
];
const ACTION_LABEL: Record<ActionType, string> = {
  OPEN_INCIDENT_REPORT: 'Report an Incident',
  OPEN_CASE_TRACKING: 'Track My Case',
  OPEN_SHELTER_LOCATOR: 'Find Shelter',
  OPEN_SHELTER_REQUEST: 'Request Shelter',
  OPEN_EMERGENCY_SOS: 'Emergency SOS',
  REQUEST_EXPERT_HELP: 'Talk to an Expert',
};

const HANDOFF_COPY: Partial<Record<ChatSessionStatus, string>> = {
  WAITING_FOR_EXPERT: 'Finding an available SafeSpace support expert…',
  EXPERT_ASSIGNED: 'A SafeSpace support representative has been assigned.',
  EXPERT_ACTIVE: 'You are now connected with a SafeSpace support representative.',
};

function messageActions(m: ChatMessage): ActionType[] {
  const raw = m.message_metadata?.actions;
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is ActionType => KNOWN_ACTIONS.includes(a as ActionType));
}

export function SafeHerAssistantScreen() {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { profile } = useAuth();
  const { session, messages, loading, sending, requestingExpert, lastError, sendMessage, requestExpertSupport } = useSupportChat(profile?.profile_id);
  const goToReportIncident = useGoToReportIncident();
  const [input, setInput] = useState('');
  const [isOffline, setIsOffline] = useState(false);
  const [emergencyDismissedFor, setEmergencyDismissedFor] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    let mounted = true;
    Network.getNetworkStateAsync().then((s) => mounted && setIsOffline(s.isConnected === false));
    const sub = Network.addNetworkStateListener((s) => setIsOffline(s.isConnected === false));
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const runAction = (type: ActionType) => {
    switch (type) {
      case 'OPEN_INCIDENT_REPORT':
        goToReportIncident();
        return;
      case 'OPEN_CASE_TRACKING':
        navigation.navigate('CasesTab');
        return;
      case 'OPEN_SHELTER_LOCATOR':
        navigation.navigate('SheltersTab');
        return;
      case 'OPEN_SHELTER_REQUEST':
        navigation.navigate('RequestShelter', {});
        return;
      case 'OPEN_EMERGENCY_SOS':
        navigation.navigate('SosTab');
        return;
      case 'REQUEST_EXPERT_HELP':
        onTalkToExpert();
        return;
    }
  };

  const onTalkToExpert = () => {
    if (session && session.status !== 'AI_ASSISTED') return; // already requested/active
    Alert.alert(
      'Talk to a SafeSpace support expert?',
      "You don't need to explain why. A SafeSpace support expert will be connected to this conversation as soon as one is available.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Request support',
          onPress: async () => {
            const { error } = await requestExpertSupport();
            if (error) Alert.alert('Could not request support', error);
          },
        },
      ]
    );
  };

  const send = () => {
    if (!input.trim()) return;
    const text = input;
    setInput('');
    sendMessage(text);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 150);
  };

  const lastMessage = messages[messages.length - 1];
  const showEmergencyPanel =
    !!lastMessage &&
    lastMessage.sender_type === 'System' &&
    (lastMessage.risk_level === 'URGENT' || lastMessage.risk_level === 'EMERGENCY') &&
    emergencyDismissedFor !== lastMessage.message_id;

  const handoffCopy = session ? HANDOFF_COPY[session.status] : undefined;
  const canType = !isOffline;

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={[styles.screen, { backgroundColor: palette.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
      <View style={[styles.header, { borderBottomColor: palette.border, paddingTop: insets.top + spacing.sm }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: palette.text }]}>SafeSpace Assistant</Text>
          <Text style={[styles.headerSubtitle, { color: palette.textMuted }]}>Support and guidance when you need it.</Text>
        </View>
        <Pressable
          onPress={onTalkToExpert}
          disabled={requestingExpert || (session ? session.status !== 'AI_ASSISTED' : false)}
          style={[styles.expertBtn, { borderColor: palette.primary }]}
          accessibilityRole="button"
          accessibilityLabel="Talk to an Expert"
        >
          <Ionicons name="person-circle-outline" size={16} color={palette.primary} />
          <Text style={[styles.expertBtnText, { color: palette.primary }]}>Expert</Text>
        </Pressable>
        <View style={{ marginLeft: spacing.sm }}>
          <HeaderActions />
        </View>
      </View>

      {isOffline && (
        <View style={[styles.banner, { backgroundColor: palette.warning + '22' }]}>
          <Text style={[styles.bannerText, { color: palette.text }]}>
            You're offline. The assistant needs internet access — Emergency SOS and previously loaded content are still available below.
          </Text>
        </View>
      )}

      {!isOffline && handoffCopy && (
        <View style={[styles.banner, { backgroundColor: palette.primaryLight }]}>
          {session?.status === 'WAITING_FOR_EXPERT' && <ActivityIndicator size="small" color={palette.primaryDark} style={{ marginRight: 8 }} />}
          <Text style={[styles.bannerText, { color: palette.primaryDark }]}>{handoffCopy}</Text>
        </View>
      )}

      {messages.length === 0 && !loading ? (
        <View style={styles.welcomeWrap}>
          <Text style={[styles.welcomeTitle, { color: palette.text }]}>How can SafeSpace help you today?</Text>
          <View style={styles.welcomeGrid}>
            <View style={styles.welcomeRow}>
              <QuickActionCard icon="document-text" tint={palette.primary} title="Report Incident" description="Submit a report" reduced={false} onPress={() => runAction('OPEN_INCIDENT_REPORT')} />
              <QuickActionCard icon="clipboard" tint={palette.primary} title="Track My Case" description="View case status" reduced={false} onPress={() => runAction('OPEN_CASE_TRACKING')} />
            </View>
            <View style={styles.welcomeRow}>
              <QuickActionCard icon="home" tint={palette.primary} title="Find Shelter" description="Nearby shelters" reduced={false} onPress={() => runAction('OPEN_SHELTER_LOCATOR')} />
              <QuickActionCard icon="hand-left" tint={palette.primary} title="Request Shelter" description="Send a direct request" reduced={false} onPress={() => runAction('OPEN_SHELTER_REQUEST')} />
            </View>
            <View style={styles.welcomeRow}>
              <QuickActionCard icon="alert-circle" tint={palette.danger} title="Emergency SOS" description="Immediate assistance" reduced={false} onPress={() => runAction('OPEN_EMERGENCY_SOS')} />
              <QuickActionCard icon="person-circle" tint={palette.primary} title="Talk to an Expert" description="Confidential support" reduced={false} onPress={onTalkToExpert} />
            </View>
          </View>
          <Text style={[styles.welcomeHint, { color: palette.textMuted }]}>Or just type a message below — SafeSpace will check verified answers first.</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.message_id}
          contentContainerStyle={{ padding: spacing.lg }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => <MessageBubble message={item} onAction={runAction} />}
        />
      )}

      {showEmergencyPanel && lastMessage && (
        <View style={[styles.emergencyPanel, { backgroundColor: palette.surface, borderColor: palette.danger }]}>
          <Text style={[styles.emergencyTitle, { color: palette.text }]}>
            {lastMessage.risk_level === 'EMERGENCY' ? 'Potential Emergency Detected' : 'You May Need Additional Support'}
          </Text>
          <View style={styles.emergencyActions}>
            <ActionChip type="OPEN_EMERGENCY_SOS" onPress={runAction} emphasis />
            <ActionChip type="REQUEST_EXPERT_HELP" onPress={runAction} />
            <ActionChip type="OPEN_SHELTER_LOCATOR" onPress={runAction} />
          </View>
          <Pressable onPress={() => setEmergencyDismissedFor(lastMessage.message_id)}>
            <Text style={[styles.emergencyDismiss, { color: palette.textMuted }]}>Continue Chat</Text>
          </Pressable>
        </View>
      )}

      {lastError && (
        <View style={[styles.banner, { backgroundColor: palette.surfaceMuted }]}>
          <Text style={[styles.bannerText, { color: palette.textMuted }]}>{lastError}</Text>
        </View>
      )}

      <View style={[styles.inputRow, { borderTopColor: palette.border }]}>
        <View style={{ flex: 1 }}>
          <Input value={input} onChangeText={setInput} placeholder={canType ? 'Ask SafeSpace anything...' : 'Offline — reconnect to send a message'} editable={canType} />
        </View>
        <View style={{ width: spacing.md }} />
        <Pressable
          onPress={send}
          disabled={sending || !canType || !input.trim()}
          style={[styles.sendBtn, { backgroundColor: palette.primary, opacity: sending || !canType || !input.trim() ? 0.5 : 1 }]}
        >
          {sending ? <ActivityIndicator color={palette.white} size="small" /> : <Ionicons name="send" size={16} color={palette.white} />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function ActionChip({ type, onPress, emphasis }: { type: ActionType; onPress: (t: ActionType) => void; emphasis?: boolean }) {
  const { palette } = useTheme();
  return (
    <Pressable
      onPress={() => onPress(type)}
      style={[
        styles.chip,
        { borderColor: emphasis ? palette.danger : palette.border, backgroundColor: emphasis ? palette.danger : 'transparent' },
      ]}
    >
      <Text style={[styles.chipText, { color: emphasis ? palette.white : palette.text }]}>{ACTION_LABEL[type]}</Text>
    </Pressable>
  );
}

function MessageBubble({ message, onAction }: { message: ChatMessage; onAction: (t: ActionType) => void }) {
  const { palette } = useTheme();
  const isUser = message.sender_type === 'User';
  const isSystem = message.sender_type === 'System';
  const isExpert = message.sender_type === 'Expert';
  const label = isUser ? null : isSystem ? 'SafeSpace' : isExpert ? 'SafeSpace Support Expert' : 'SafeSpace AI Assistant';
  const actions = messageActions(message);

  if (isSystem) {
    return (
      <View style={styles.systemRow}>
        <Text style={[styles.systemText, { color: palette.textMuted, backgroundColor: palette.surfaceMuted }]}>{message.message}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
      <View style={[styles.bubble, isUser ? { backgroundColor: palette.primary } : { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border }]}>
        {label && <Text style={[styles.bubbleLabel, { color: palette.textMuted }]}>{label}</Text>}
        <Text style={[styles.bubbleText, { color: isUser ? palette.white : palette.text }]}>{message.message}</Text>
        {actions.length > 0 && (
          <View style={styles.bubbleActions}>
            {actions.map((a) => (
              <ActionChip key={a} type={a} onPress={onAction} />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1 },
  headerTitle: { ...typography.heading, fontSize: 19 },
  headerSubtitle: { ...typography.caption, marginTop: 2 },
  expertBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 },
  expertBtnText: { ...typography.caption, fontFamily: 'Inter_600SemiBold' as any },
  banner: { flexDirection: 'row', alignItems: 'center', padding: spacing.sm, paddingHorizontal: spacing.md },
  bannerText: { ...typography.caption, flex: 1 },
  welcomeWrap: { flex: 1, padding: spacing.lg },
  welcomeTitle: { ...typography.heading, fontSize: 18, marginBottom: spacing.md },
  welcomeGrid: { gap: spacing.md },
  welcomeRow: { flexDirection: 'row', gap: spacing.md },
  welcomeHint: { ...typography.caption, textAlign: 'center', marginTop: spacing.lg },
  bubbleRow: { flexDirection: 'row', marginBottom: spacing.sm },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '82%', padding: spacing.sm, borderRadius: radius.md },
  bubbleLabel: { ...typography.caption, fontSize: 11, marginBottom: 2 },
  bubbleText: { ...typography.body },
  bubbleActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { ...typography.caption, fontFamily: 'Inter_600SemiBold' as any },
  systemRow: { alignItems: 'center', marginVertical: spacing.sm },
  systemText: { ...typography.caption, textAlign: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, overflow: 'hidden' },
  emergencyPanel: { margin: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5 },
  emergencyTitle: { ...typography.bodyMedium, marginBottom: spacing.sm, textAlign: 'center' },
  emergencyActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  emergencyDismiss: { ...typography.caption, textAlign: 'center', marginTop: spacing.sm },
  inputRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderTopWidth: 1 },
  sendBtn: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
