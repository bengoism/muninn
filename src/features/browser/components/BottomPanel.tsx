import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAgentSessionStore } from '../../../state/agent-session-store';
import { useChatStore, type ChatMessage } from '../../../state/chat-store';

type Tab = 'chat' | 'debug';

type BottomPanelProps = {
  onStart: (goal: string) => void;
  onCancel: () => void;
  isRunning: boolean;
  modelReady: boolean;
};

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

export function BottomPanel({ onStart, onCancel, isRunning, modelReady }: BottomPanelProps) {
  const sheetRef = useRef<BottomSheet>(null);
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const snapPoints = useMemo(() => [100, '50%', '85%'], []);

  const goal = useAgentSessionStore((s) => s.goal);
  const setGoal = useAgentSessionStore((s) => s.setGoal);
  const loopState = useAgentSessionStore((s) => s.loopState);
  const messages = useChatStore((s) => s.messages);

  const isTerminal =
    loopState === 'finished' ||
    loopState === 'yielded' ||
    loopState === 'failed';

  // Auto-expand when agent starts
  useEffect(() => {
    if (isRunning) {
      sheetRef.current?.snapToIndex(1);
    }
  }, [isRunning]);

  return (
    <BottomSheet
      ref={sheetRef}
      snapPoints={snapPoints}
      index={0}
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.handleIndicator}
      enablePanDownToClose={false}
    >
      {/* Goal input row */}
      <View style={styles.goalRow}>
        <TextInput
          editable={!isRunning}
          onChangeText={setGoal}
          onSubmitEditing={() => {
            if (goal.trim() && modelReady && !isRunning) {
              onStart(goal.trim());
            }
          }}
          placeholder="What should the agent do?"
          placeholderTextColor="#506680"
          returnKeyType="go"
          style={[styles.goalInput, isRunning && styles.goalInputRunning]}
          value={goal}
        />
        {isRunning ? (
          <Pressable onPress={onCancel} style={styles.stopButton}>
            <Text style={styles.stopButtonText}>Stop</Text>
          </Pressable>
        ) : isTerminal ? (
          <Pressable
            onPress={() => {
              useAgentSessionStore.getState().setLoopState('idle');
              useAgentSessionStore.getState().setLastError(null);
            }}
            style={styles.goButton}
          >
            <Text style={styles.goButtonText}>New</Text>
          </Pressable>
        ) : (
          <Pressable
            disabled={!modelReady || !goal.trim()}
            onPress={() => onStart(goal.trim())}
            style={[
              styles.goButton,
              (!modelReady || !goal.trim()) && styles.buttonDisabled,
            ]}
          >
            <Text
              style={[
                styles.goButtonText,
                (!modelReady || !goal.trim()) && styles.buttonTextDisabled,
              ]}
            >
              Go
            </Text>
          </Pressable>
        )}
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <Pressable
          onPress={() => setActiveTab('chat')}
          style={[styles.tab, activeTab === 'chat' && styles.tabActive]}
        >
          <Text style={[styles.tabText, activeTab === 'chat' && styles.tabTextActive]}>
            Chat
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setActiveTab('debug')}
          style={[styles.tab, activeTab === 'debug' && styles.tabActive]}
        >
          <Text style={[styles.tabText, activeTab === 'debug' && styles.tabTextActive]}>
            Debug
          </Text>
        </Pressable>
      </View>

      {/* Content */}
      {activeTab === 'chat' ? (
        messages.length > 0 ? (
          <BottomSheetFlatList
            data={messages}
            keyExtractor={(_: ChatMessage, i: number) => String(i)}
            renderItem={({ item }: { item: ChatMessage }) => <ChatMessageRow message={item} />}
            contentContainerStyle={styles.listContent}
          />
        ) : (
          <View style={styles.emptyContent}>
            <Text style={styles.emptyText}>Agent activity will appear here</Text>
          </View>
        )
      ) : (
        <View style={styles.emptyContent}>
          <Text style={styles.emptyText}>Debug telemetry coming soon</Text>
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  background: {
    backgroundColor: '#0d1728',
  },
  handleIndicator: {
    backgroundColor: '#2a3f5c',
    width: 36,
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
  },
  goalInput: {
    flex: 1,
    backgroundColor: '#101927',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1f344d',
    color: '#f8fafc',
    fontSize: 14,
    height: 36,
    paddingHorizontal: 14,
  },
  goalInputRunning: {
    borderColor: '#38bdf8',
    opacity: 0.7,
  },
  goButton: {
    backgroundColor: '#38bdf8',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  goButtonText: {
    color: '#0b1117',
    fontSize: 14,
    fontWeight: '700',
  },
  stopButton: {
    backgroundColor: '#7f1d1d',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  stopButtonText: {
    color: '#fca5a5',
    fontSize: 14,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonTextDisabled: {
    opacity: 0.6,
  },
  tabBar: {
    flexDirection: 'row',
    gap: 2,
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 12,
  },
  tabActive: {
    backgroundColor: '#172540',
  },
  tabText: {
    color: '#506680',
    fontSize: 12,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#7dd3fc',
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
    fontSize: 12,
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
  emptyContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
  },
  emptyText: {
    color: '#506680',
    fontSize: 13,
  },
});
