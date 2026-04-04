import BottomSheet, { BottomSheetFlatList, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAgentSessionStore } from '../../../state/agent-session-store';
import { useChatStore, type ChatMessage } from '../../../state/chat-store';

type Tab = 'chat' | 'debug';

type BottomPanelProps = {
  onStart: (goal: string) => void;
  onCancel: () => void;
  isRunning: boolean;
  modelReady: boolean;
  modelName: string | null;
};

function humanizeAction(action: string, params: Record<string, unknown>): string {
  const id = params.id as string | undefined;
  const text = params.text as string | undefined;
  const value = params.value as string | undefined;

  switch (action) {
    case 'click': return `Clicked ${id ? `element` : 'on page'}`;
    case 'tap_coordinates': return `Tapped at (${params.x}, ${params.y})`;
    case 'type': return `Typed "${text}"`;
    case 'fill': return `Filled "${text}"`;
    case 'select': return `Selected "${value}"`;
    case 'scroll': return `Scrolled ${params.direction}`;
    case 'hover': return `Hovered element`;
    case 'focus': return `Focused element`;
    case 'gettext': return `Read text from element`;
    case 'eval': return `Ran JavaScript`;
    case 'go_back': return `Went back`;
    case 'wait': return `Waited for ${params.condition || 'page'}`;
    case 'finish': return (params.message as string) || 'Done';
    default: return action;
  }
}

function ThinkingIndicator({ loopState }: { loopState: string }) {
  const label =
    loopState === 'observing' ? 'Looking at page...' :
    loopState === 'reasoning' ? 'Thinking...' :
    loopState === 'acting' ? 'Taking action...' :
    loopState === 'validating' ? 'Checking result...' :
    loopState === 'retrying' ? 'Retrying...' :
    null;

  if (!label) return null;

  return (
    <View style={styles.thinkingRow}>
      <View style={styles.thinkingDot} />
      <Text style={styles.thinkingText}>{label}</Text>
    </View>
  );
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
    if (message.status === 'started') return null;

    const isError = message.status === 'error' || message.status === 'stopped';
    const isFinished = message.status === 'finished';

    return (
      <View style={styles.infoBoxRow}>
        <View style={[
          styles.infoBox,
          isFinished && styles.infoBoxSuccess,
          isError && styles.infoBoxError,
        ]}>
          <Text style={[
            styles.infoBoxText,
            isFinished && styles.infoBoxTextSuccess,
            isError && styles.infoBoxTextError,
          ]}>
            {message.message}
          </Text>
        </View>
      </View>
    );
  }

  if (message.type === 'agent_step') {
    const isSuccess = message.outcome === 'success';
    const humanized = humanizeAction(message.action, message.params);
    const detail = message.urlChanged ? 'Navigated to new page' :
      (!isSuccess && message.reason) ? message.reason.split('.')[0] : null;

    return (
      <View style={styles.stepRow}>
        <View style={[styles.stepDot, isSuccess ? styles.stepDotSuccess : styles.stepDotFail]} />
        <View style={styles.stepContent}>
          <Text style={[styles.stepLabel, !isSuccess && styles.stepLabelFail]}>
            {humanized}
          </Text>
          {detail && (
            <Text style={styles.stepDetail}>{detail}</Text>
          )}
        </View>
      </View>
    );
  }

  return null;
}

export function BottomPanel({ onStart, onCancel, isRunning, modelReady, modelName }: BottomPanelProps) {
  const sheetRef = useRef<BottomSheet>(null);
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const snapPoints = useMemo(() => ['12%', '50%', '85%'], []);

  const goal = useAgentSessionStore((s) => s.goal);
  const setGoal = useAgentSessionStore((s) => s.setGoal);
  const loopState = useAgentSessionStore((s) => s.loopState);
  const messages = useChatStore((s) => s.messages);
  const sheetIndex = useRef(0);

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
      onChange={(index: number) => { sheetIndex.current = index; }}
    >
      {/* Goal input */}
      <View style={styles.goalRow}>
        <BottomSheetTextInput
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
        <View style={{ flex: 1 }} />
        {messages.length > 0 && (
          <Pressable onPress={() => useChatStore.getState().clear()} style={styles.clearButton}>
            <Text style={styles.clearButtonText}>Clear</Text>
          </Pressable>
        )}
        {modelName && (
          <Text style={styles.modelLabel}>{modelName}</Text>
        )}
      </View>

      {/* Content */}
      {activeTab === 'chat' ? (
        messages.length > 0 ? (
          <BottomSheetFlatList
            data={messages}
            keyExtractor={(_: ChatMessage, i: number) => String(i)}
            renderItem={({ item }: { item: ChatMessage }) => <ChatMessageRow message={item} />}
            contentContainerStyle={styles.listContent}
            ListFooterComponent={isRunning ? <ThinkingIndicator loopState={loopState} /> : null}
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
    backgroundColor: '#222',
  },
  handle: {
    backgroundColor: '#444',
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
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#333',
    color: '#ededed',
    fontSize: 14,
    height: 38,
    paddingHorizontal: 12,
  },
  goalInputRunning: {
    borderColor: '#444',
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
    backgroundColor: '#333',
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
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#333',
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
  clearButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'center',
  },
  clearButtonText: {
    color: '#555',
    fontSize: 11,
    fontWeight: '500',
  },
  modelLabel: {
    color: '#555',
    fontSize: 11,
    fontWeight: '500',
    alignSelf: 'center',
    paddingRight: 4,
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
    backgroundColor: '#2a2a2a',
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
  // Steps
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  stepDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
  },
  stepDotSuccess: {
    backgroundColor: '#555',
  },
  stepDotFail: {
    backgroundColor: '#ff4747',
  },
  stepContent: {
    flex: 1,
    gap: 2,
  },
  stepLabel: {
    color: '#aaa',
    fontSize: 13,
    lineHeight: 18,
  },
  stepLabelFail: {
    color: '#ff4747',
  },
  stepDetail: {
    color: '#555',
    fontSize: 12,
    lineHeight: 16,
  },
  // Info boxes (success/error)
  infoBoxRow: {
    paddingVertical: 2,
  },
  infoBox: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  infoBoxSuccess: {
    borderColor: 'rgba(0,212,126,0.3)',
    backgroundColor: 'rgba(0,212,126,0.06)',
  },
  infoBoxError: {
    borderColor: 'rgba(255,71,71,0.3)',
    backgroundColor: 'rgba(255,71,71,0.06)',
  },
  infoBoxText: {
    color: '#888',
    fontSize: 13,
    lineHeight: 18,
  },
  infoBoxTextSuccess: {
    color: '#00d47e',
  },
  infoBoxTextError: {
    color: '#ff4747',
  },
  // Thinking indicator
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  thinkingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#555',
    opacity: 0.6,
  },
  thinkingText: {
    color: '#555',
    fontSize: 13,
    fontStyle: 'italic',
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
