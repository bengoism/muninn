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
      message.status === 'finished' ? '#00d47e' :
      message.status === 'error' || message.status === 'stopped' ? '#ff4747' :
      '#888';

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
      backgroundStyle={styles.sheetBg}
      handleIndicatorStyle={styles.handle}
      enablePanDownToClose={false}
    >
      {/* Goal input */}
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
          placeholderTextColor="#555"
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
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>New</Text>
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
            <Text style={styles.goButtonText}>Go</Text>
          </Pressable>
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        <Pressable
          onPress={() => setActiveTab('chat')}
          style={[styles.tab, activeTab === 'chat' && styles.tabActive]}
        >
          <Text style={[styles.tabText, activeTab === 'chat' && styles.tabTextActive]}>
            CHAT
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setActiveTab('debug')}
          style={[styles.tab, activeTab === 'debug' && styles.tabActive]}
        >
          <Text style={[styles.tabText, activeTab === 'debug' && styles.tabTextActive]}>
            DEBUG
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
  sheetBg: {
    backgroundColor: '#141414',
  },
  handle: {
    backgroundColor: '#333',
    width: 32,
    height: 3,
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
  },
  goalInput: {
    flex: 1,
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#222',
    color: '#ededed',
    fontSize: 14,
    height: 38,
    paddingHorizontal: 12,
  },
  goalInputRunning: {
    borderColor: '#333',
    opacity: 0.6,
  },
  goButton: {
    backgroundColor: '#fff',
    borderRadius: 8,
    height: 38,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  goButtonText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '600',
  },
  stopButton: {
    backgroundColor: 'rgba(255,71,71,0.15)',
    borderRadius: 8,
    height: 38,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  stopButtonText: {
    color: '#ff4747',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#222',
    borderRadius: 8,
    height: 38,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  secondaryButtonText: {
    color: '#ededed',
    fontSize: 14,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.3,
  },
  tabBar: {
    flexDirection: 'row',
    gap: 0,
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222',
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#ededed',
  },
  tabText: {
    color: '#555',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.8,
  },
  tabTextActive: {
    color: '#ededed',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  userRow: {
    alignItems: 'flex-end',
  },
  userBubble: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '85%',
  },
  userText: {
    color: '#ededed',
    fontSize: 14,
    lineHeight: 20,
  },
  agentRow: {
    alignItems: 'flex-start',
  },
  stepText: {
    color: '#888',
    fontSize: 13,
    lineHeight: 18,
  },
  stepTextFailed: {
    color: '#ff4747',
  },
  statusRow: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  emptyContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyText: {
    color: '#555',
    fontSize: 13,
  },
});
