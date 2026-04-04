import { useEffect, useRef } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { useChatStore, type ChatMessage } from '../../../state/chat-store';

function formatStep(msg: ChatMessage & { type: 'agent_step' }): string {
  const icon =
    msg.outcome === 'success' ? '\u2713' :
    msg.outcome === 'no_op' ? '\u2013' :
    msg.outcome === 'blocked' ? '\u2717' :
    msg.outcome === 'stale_ref' ? '\u26A0' :
    '\u2717';

  const action = msg.action;
  const paramStr = Object.entries(msg.params)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v}"` : v}`)
    .join(', ');

  let summary = `${action}(${paramStr})`;

  if (msg.outcome === 'success' && msg.urlChanged) {
    summary += ' \u2192 navigated';
  } else if (msg.outcome !== 'success' && msg.reason) {
    const shortReason = msg.reason.split('.')[0];
    summary += ` \u2192 ${shortReason}`;
  }

  return `${icon} ${summary}`;
}

function ChatMessageRow({ message }: { message: ChatMessage }) {
  if (message.type === 'user') {
    return (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{message.text}</Text>
        </View>
      </View>
    );
  }

  if (message.type === 'agent_status') {
    const color =
      message.status === 'finished' ? '#4ade80' :
      message.status === 'error' || message.status === 'stopped' ? '#f87171' :
      '#7dd3fc';

    return (
      <View style={styles.statusRow}>
        <Text style={[styles.statusText, { color }]}>{message.message}</Text>
      </View>
    );
  }

  if (message.type === 'agent_step') {
    const isSuccess = message.outcome === 'success';
    return (
      <View style={styles.agentRow}>
        <Text style={[styles.stepText, !isSuccess && styles.stepTextFailed]}>
          {formatStep(message)}
        </Text>
      </View>
    );
  }

  return null;
}

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Agent activity will appear here</Text>
      </View>
    );
  }

  return (
    <FlatList
      ref={listRef}
      data={messages}
      keyExtractor={(_, i) => String(i)}
      renderItem={({ item }) => <ChatMessageRow message={item} />}
      style={styles.list}
      contentContainerStyle={styles.listContent}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  userRow: {
    alignItems: 'flex-end',
  },
  userBubble: {
    backgroundColor: '#1e3a5f',
    borderRadius: 16,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: '80%',
  },
  userText: {
    color: '#f8fafc',
    fontSize: 14,
  },
  agentRow: {
    alignItems: 'flex-start',
  },
  stepText: {
    color: '#8ca0bd',
    fontSize: 13,
    fontFamily: 'Menlo',
  },
  stepTextFailed: {
    color: '#f87171',
  },
  statusRow: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: '#506680',
    fontSize: 13,
  },
});
