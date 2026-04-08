import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  Keyboard,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAgentSessionStore } from '../../../state/agent-session-store';
import { useChatStore, type ChatMessage } from '../../../state/chat-store';
import { useDebugStore } from '../../../state/debug-store';
import type { PlanItem, SessionPlan } from '../../../types/agent';

type Tab = 'chat' | 'debug';

type BottomPanelProps = {
  onStart: (goal: string) => void;
  onCancel: () => void;
  isRunning: boolean;
  modelReady: boolean;
  modelName: string | null;
};

const SCREEN_H = Dimensions.get('window').height;
const SNAP_COLLAPSED = 120;
const SNAP_HALF = Math.round(SCREEN_H * 0.5);
const SNAP_FULL = Math.round(SCREEN_H * 0.85);
const SNAPS = [SNAP_COLLAPSED, SNAP_HALF, SNAP_FULL];

function snapTo(value: number): number {
  let closest = SNAPS[0];
  let minDist = Math.abs(value - closest);
  for (const snap of SNAPS) {
    const dist = Math.abs(value - snap);
    if (dist < minDist) {
      closest = snap;
      minDist = dist;
    }
  }
  return closest;
}

function humanizeAction(action: string, params: Record<string, unknown>): string {
  const text = params.text as string | undefined;
  const value = params.value as string | undefined;
  switch (action) {
    case 'click': return 'Clicked element';
    case 'tap_coordinates': return `Tapped at (${params.x}, ${params.y})`;
    case 'type': return `Typed "${text}"`;
    case 'fill': return `Filled "${text}"`;
    case 'select': return `Selected "${value}"`;
    case 'scroll': return `Scrolled ${params.direction}`;
    case 'hover': return 'Hovered element';
    case 'focus': return 'Focused element';
    case 'gettext': return 'Read text';
    case 'eval': return 'Ran JavaScript';
    case 'go_back': return 'Went back';
    case 'wait': return `Waited for ${params.condition || 'page'}`;
    case 'finish': return (params.message as string) || 'Done';
    default: return action;
  }
}

function getStepTone(
  outcome: ChatMessage extends infer Message
    ? Message extends { type: 'agent_step'; outcome: infer Outcome }
      ? Outcome
      : never
    : never,
) {
  switch (outcome) {
    case 'success':
      return { dot: styles.stepDotSuccess, label: styles.stepLabelNeutral, detail: styles.stepDetailNeutral };
    case 'partial_success':
      return { dot: styles.stepDotProgress, label: styles.stepLabelNeutral, detail: styles.stepDetailPositive };
    case 'no_op':
    case 'blocked':
    case 'stale_ref':
      return { dot: styles.stepDotWarn, label: styles.stepLabelNeutral, detail: styles.stepDetailWarn };
    case 'failed':
    default:
      return { dot: styles.stepDotError, label: styles.stepLabelNeutral, detail: styles.stepDetailError };
  }
}

function formatPlanItemStatus(status: PlanItem['status']) {
  switch (status) {
    case 'in_progress':
      return 'In progress';
    case 'completed':
      return 'Done';
    case 'blocked':
      return 'Blocked';
    case 'dropped':
      return 'Dropped';
    case 'pending':
    default:
      return 'Pending';
  }
}

function formatPlanPhase(plan: SessionPlan['phase']) {
  switch (plan) {
    case 'initial':
      return 'Initial';
    case 'search':
      return 'Search';
    case 'results':
      return 'Results';
    case 'detail':
      return 'Detail';
    case 'form':
      return 'Form';
    case 'checkout':
      return 'Checkout';
    case 'blocked':
      return 'Blocked';
    case 'done':
      return 'Done';
    default:
      return plan;
  }
}

function PlanCard({ plan }: { plan: SessionPlan | null }) {
  if (!plan) {
    return null;
  }

  const activeItem =
    plan.items.find((item) => item.id === plan.activeItemId) ?? null;
  const visibleItems = plan.items.filter((item) => item.status !== 'dropped').slice(0, 4);

  return (
    <View style={styles.planCard}>
      <View style={styles.planHeader}>
        <Text style={styles.planEyebrow}>Plan</Text>
        <View style={styles.planPhaseBadge}>
          <Text style={styles.planPhaseText}>{formatPlanPhase(plan.phase)}</Text>
        </View>
      </View>
      {activeItem ? (
        <Text style={styles.planActiveTodo}>{activeItem.text}</Text>
      ) : (
        <Text style={styles.planActiveTodoMuted}>No active todo</Text>
      )}
      {plan.lastConfirmedProgress ? (
        <Text style={styles.planProgress}>{plan.lastConfirmedProgress}</Text>
      ) : null}
      <View style={styles.planTodoList}>
        {visibleItems.map((item) => {
          const isActive = item.id === plan.activeItemId;
          return (
            <View
              key={item.id}
              style={[styles.planTodoRow, isActive && styles.planTodoRowActive]}
            >
              <View
                style={[
                  styles.planTodoStatusDot,
                  item.status === 'completed'
                    ? styles.planTodoStatusDone
                    : item.status === 'in_progress'
                      ? styles.planTodoStatusActive
                      : item.status === 'blocked'
                        ? styles.planTodoStatusBlocked
                        : styles.planTodoStatusPending,
                ]}
              />
              <View style={styles.planTodoCopy}>
                <Text
                  style={[
                    styles.planTodoText,
                    item.status === 'completed' && styles.planTodoTextDone,
                  ]}
                >
                  {item.text}
                </Text>
                <Text style={styles.planTodoMeta}>
                  {formatPlanItemStatus(item.status)}
                  {isActive ? ' · Active' : ''}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
      {plan.avoidRefs.length > 0 ? (
        <Text style={styles.planAvoidRefs}>
          Avoiding {plan.avoidRefs.map((entry) => entry.ref).join(', ')} for now
        </Text>
      ) : null}
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
        <View style={[styles.infoBox, isFinished && styles.infoBoxSuccess, isError && styles.infoBoxError]}>
          <Text style={[styles.infoBoxText, isFinished && styles.infoBoxTextSuccess, isError && styles.infoBoxTextError]}>
            {message.message}
          </Text>
        </View>
      </View>
    );
  }

  if (message.type === 'agent_step') {
    const humanized = humanizeAction(message.action, message.params);
    const tone = getStepTone(message.outcome);
    const detail = message.urlChanged ? 'Navigated to new page' :
      (message.reason ? message.reason.split('.')[0] : null);
    return (
      <View style={styles.stepRow}>
        <View style={[styles.stepDot, tone.dot]} />
        <View style={styles.stepContent}>
          <Text style={[styles.stepLabel, tone.label]}>{humanized}</Text>
          {detail && <Text style={[styles.stepDetail, tone.detail]}>{detail}</Text>}
        </View>
      </View>
    );
  }

  return null;
}

function ThinkingFooter({ loopState }: { loopState: string }) {
  const label =
    loopState === 'observing' ? 'Looking at page...' :
    loopState === 'reasoning' ? 'Thinking...' :
    loopState === 'acting' ? 'Taking action...' :
    loopState === 'validating' ? 'Checking result...' :
    loopState === 'retrying' ? 'Retrying...' : null;
  if (!label) return null;
  return (
    <View style={styles.thinkingRow}>
      <View style={styles.thinkingDot} />
      <Text style={styles.thinkingText}>{label}</Text>
    </View>
  );
}

export function BottomPanel({ onStart, onCancel, isRunning, modelReady, modelName }: BottomPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const heightAnim = useRef(new Animated.Value(SNAP_COLLAPSED)).current;
  const currentHeight = useRef(SNAP_COLLAPSED);
  const listRef = useRef<FlatList>(null);

  const goal = useAgentSessionStore((s) => s.goal);
  const setGoal = useAgentSessionStore((s) => s.setGoal);
  const loopState = useAgentSessionStore((s) => s.loopState);
  const plan = useAgentSessionStore((s) => s.plan);
  const messages = useChatStore((s) => s.messages);
  const actionTraces = useDebugStore((s) => s.actionTraces);
  const lastLocatorProbe = useDebugStore((s) => s.lastLocatorProbe);
  const consoleMessages = useDebugStore((s) => s.consoleMessages);
  const networkEvents = useDebugStore((s) => s.networkEvents);

  const isTerminal = loopState === 'finished' || loopState === 'yielded' || loopState === 'failed';

  const animateTo = useCallback((target: number) => {
    currentHeight.current = target;
    Animated.spring(heightAnim, {
      toValue: target,
      useNativeDriver: false,
      tension: 65,
      friction: 11,
    }).start();
  }, [heightAnim]);

  const dragStart = useRef(SNAP_COLLAPSED);

  const onHandleMove = (_: any, g: any) => {
    const newH = Math.max(SNAP_COLLAPSED, Math.min(SNAP_FULL, dragStart.current - g.dy));
    heightAnim.setValue(newH);
  };

  const onHandleRelease = (_: any, g: any) => {
    const finalH = dragStart.current - g.dy;
    const projected = finalH - g.vy * 200;
    const target = snapTo(projected);
    currentHeight.current = target;
    dragStart.current = target;
    Animated.timing(heightAnim, { toValue: target, duration: 180, useNativeDriver: false }).start();
    if (target === SNAP_COLLAPSED) Keyboard.dismiss();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { dragStart.current = currentHeight.current; },
      onPanResponderMove: onHandleMove,
      onPanResponderRelease: onHandleRelease,
      onPanResponderTerminate: onHandleRelease,
    })
  ).current;

  useEffect(() => {
    if (isRunning && currentHeight.current === SNAP_COLLAPSED) {
      animateTo(SNAP_HALF);
    }
  }, [animateTo, isRunning]);

  useEffect(() => {
    if (messages.length > 0 && currentHeight.current > SNAP_COLLAPSED) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 150);
    }
  }, [messages.length]);

  return (
    <Animated.View style={[styles.container, { height: heightAnim }]}>
      {/* Drag handle */}
      <View {...panResponder.panHandlers} style={styles.handleArea}>
        <View style={styles.handle} />
      </View>

      {/* Goal input */}
      <View style={styles.goalRow}>
        <TextInput
          editable={!isRunning}
          onChangeText={setGoal}
          onFocus={() => { if (currentHeight.current === SNAP_COLLAPSED) animateTo(SNAP_HALF); }}
          onSubmitEditing={() => {
            if (goal.trim() && modelReady && !isRunning) {
              Keyboard.dismiss();
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
            <Text style={styles.stopText}>Stop</Text>
          </Pressable>
        ) : isTerminal ? (
          <Pressable onPress={() => { useAgentSessionStore.getState().setLoopState('idle'); useAgentSessionStore.getState().setLastError(null); }} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>New</Text>
          </Pressable>
        ) : (
          <Pressable
            disabled={!modelReady || !goal.trim()}
            onPress={() => { Keyboard.dismiss(); onStart(goal.trim()); }}
            style={[styles.goButton, (!modelReady || !goal.trim()) && styles.disabled]}
          >
            <Text style={styles.goText}>Go</Text>
          </Pressable>
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        <Pressable onPress={() => setActiveTab('chat')} style={[styles.tab, activeTab === 'chat' && styles.tabActive]}>
          <Text style={[styles.tabText, activeTab === 'chat' && styles.tabTextActive]}>CHAT</Text>
        </Pressable>
        <Pressable onPress={() => setActiveTab('debug')} style={[styles.tab, activeTab === 'debug' && styles.tabActive]}>
          <Text style={[styles.tabText, activeTab === 'debug' && styles.tabTextActive]}>DEBUG</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        {messages.length > 0 && (
          <Pressable onPress={() => useChatStore.getState().clear()} style={styles.clearBtn}>
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        )}
        {modelName && <Text style={styles.modelLabel}>{modelName}</Text>}
      </View>

      {/* Content */}
      {activeTab === 'chat' ? (
        messages.length > 0 ? (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(_, i) => String(i)}
            renderItem={({ item }) => <ChatMessageRow message={item} />}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={<PlanCard plan={plan} />}
            ListFooterComponent={isRunning ? <ThinkingFooter loopState={loopState} /> : null}
          />
        ) : (
          <View style={styles.empty}>
            <PlanCard plan={plan} />
            <Text style={styles.emptyText}>Agent activity will appear here</Text>
          </View>
        )
      ) : (
        <View style={styles.debugContent}>
          <Text style={styles.debugTitle}>Last action</Text>
          <Text style={styles.debugText}>
            {formatLastActionTrace(actionTraces[actionTraces.length - 1] ?? null)}
          </Text>
          <Text style={styles.debugTitle}>Last locator probe</Text>
          <Text style={styles.debugText}>
            {lastLocatorProbe
              ? `${lastLocatorProbe.targetId} | ${lastLocatorProbe.ok ? 'ok' : 'failed'} | ${lastLocatorProbe.reason ?? 'None'}`
              : 'Not run'}
          </Text>
          <Text style={styles.debugTitle}>Console</Text>
          <Text style={styles.debugText}>
            {consoleMessages.length > 0
              ? consoleMessages
                  .slice(-5)
                  .map((message) => `${message.payload.level}: ${message.payload.args.map((arg) => JSON.stringify(arg)).join(' ')}`)
                  .join('\n')
              : 'None'}
          </Text>
          <Text style={styles.debugTitle}>Network</Text>
          <Text style={styles.debugText}>
            {networkEvents.length > 0
              ? networkEvents
                  .slice(-5)
                  .map((event) => `${event.payload.transport}:${event.payload.phase} ${event.payload.method} ${event.payload.url}`)
                  .join('\n')
              : 'None'}
          </Text>
        </View>
      )}
    </Animated.View>
  );
}

function formatLastActionTrace(
  trace: ReturnType<typeof useDebugStore.getState>['actionTraces'][number] | null
) {
  if (!trace) {
    return 'None';
  }

  return [
    `step ${trace.step} | ${trace.action}`,
    trace.targetState ? `target=${trace.targetState}` : null,
    trace.executor
      ? `executor=${trace.executor.ok ? 'ok' : 'failed'} | ${trace.executor.reason ?? 'None'}`
      : null,
    trace.validation
      ? `validation=${trace.validation.outcome} | ${trace.validation.reason ?? 'None'}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#222', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#333', overflow: 'hidden' },
  handleArea: { alignItems: 'center', paddingVertical: 10 },
  handle: { width: 32, height: 4, borderRadius: 2, backgroundColor: '#444' },
  goalRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  goalInput: { flex: 1, backgroundColor: '#2a2a2a', borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: '#333', color: '#ededed', fontSize: 14, height: 38, paddingHorizontal: 12 },
  goalInputRunning: { borderColor: '#444', opacity: 0.6 },
  goButton: { backgroundColor: '#fff', borderRadius: 8, height: 38, justifyContent: 'center', paddingHorizontal: 18 },
  goText: { color: '#000', fontSize: 14, fontWeight: '600' },
  stopButton: { backgroundColor: 'rgba(255,71,71,0.15)', borderRadius: 8, height: 38, justifyContent: 'center', paddingHorizontal: 18 },
  stopText: { color: '#ff4747', fontSize: 14, fontWeight: '600' },
  secondaryButton: { backgroundColor: '#333', borderRadius: 8, height: 38, justifyContent: 'center', paddingHorizontal: 18 },
  secondaryText: { color: '#ededed', fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.3 },
  tabBar: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#333' },
  tab: { paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#ededed' },
  tabText: { color: '#555', fontSize: 11, fontWeight: '500', letterSpacing: 0.8 },
  tabTextActive: { color: '#ededed' },
  clearBtn: { paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'center' },
  clearText: { color: '#555', fontSize: 11, fontWeight: '500' },
  modelLabel: { color: '#555', fontSize: 11, fontWeight: '500', alignSelf: 'center', paddingRight: 4 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  planCard: {
    backgroundColor: '#262626',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3a3a3a',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    marginBottom: 10,
  },
  planHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planEyebrow: { color: '#7d7d7d', fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  planPhaseBadge: {
    backgroundColor: 'rgba(145, 196, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(145, 196, 255, 0.22)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  planPhaseText: { color: '#b8d4ff', fontSize: 11, fontWeight: '600' },
  planActiveTodo: { color: '#f2f2f2', fontSize: 15, lineHeight: 20, fontWeight: '600' },
  planActiveTodoMuted: { color: '#8a8a8a', fontSize: 14, lineHeight: 20 },
  planProgress: { color: '#9dd6b7', fontSize: 12, lineHeight: 17 },
  planTodoList: { gap: 8 },
  planTodoRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  planTodoRowActive: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 7, marginHorizontal: -8 },
  planTodoStatusDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  planTodoStatusDone: { backgroundColor: '#34c759' },
  planTodoStatusActive: { backgroundColor: '#63a5ff' },
  planTodoStatusBlocked: { backgroundColor: '#f3b35a' },
  planTodoStatusPending: { backgroundColor: '#595959' },
  planTodoCopy: { flex: 1, gap: 2 },
  planTodoText: { color: '#d8d8d8', fontSize: 13, lineHeight: 18 },
  planTodoTextDone: { color: '#8dbe9c' },
  planTodoMeta: { color: '#7c7c7c', fontSize: 11, lineHeight: 15 },
  planAvoidRefs: { color: '#b99a67', fontSize: 11, lineHeight: 15 },
  userRow: { alignItems: 'flex-end' },
  userBubble: { backgroundColor: '#2a2a2a', borderRadius: 12, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '85%' },
  userText: { color: '#ededed', fontSize: 14, lineHeight: 20 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stepDot: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  stepDotSuccess: { backgroundColor: '#4f8cff' },
  stepDotProgress: { backgroundColor: '#6ed6a0' },
  stepDotWarn: { backgroundColor: '#f3b35a' },
  stepDotError: { backgroundColor: '#ff6b6b' },
  stepContent: { flex: 1, gap: 2 },
  stepLabel: { color: '#aaa', fontSize: 13, lineHeight: 18 },
  stepLabelNeutral: { color: '#d5d5d5' },
  stepDetail: { color: '#555', fontSize: 12, lineHeight: 16 },
  stepDetailNeutral: { color: '#6f6f6f' },
  stepDetailPositive: { color: '#78c99b' },
  stepDetailWarn: { color: '#d4a65e' },
  stepDetailError: { color: '#e28787' },
  infoBoxRow: { paddingVertical: 2 },
  infoBox: { borderRadius: 8, borderWidth: 1, borderColor: '#333', backgroundColor: 'rgba(255,255,255,0.03)', paddingHorizontal: 14, paddingVertical: 10 },
  infoBoxSuccess: { borderColor: 'rgba(0,212,126,0.3)', backgroundColor: 'rgba(0,212,126,0.06)' },
  infoBoxError: { borderColor: 'rgba(255,71,71,0.3)', backgroundColor: 'rgba(255,71,71,0.06)' },
  infoBoxText: { color: '#888', fontSize: 13, lineHeight: 18 },
  infoBoxTextSuccess: { color: '#00d47e' },
  infoBoxTextError: { color: '#ff4747' },
  thinkingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  thinkingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#555', opacity: 0.6 },
  thinkingText: { color: '#555', fontSize: 13, fontStyle: 'italic' },
  debugContent: { flex: 1, paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  debugTitle: { color: '#888', fontSize: 11, fontWeight: '600', letterSpacing: 0.8 },
  debugText: { color: '#666', fontSize: 12, lineHeight: 17, fontFamily: 'Menlo' },
  empty: { flex: 1, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 24, gap: 16 },
  emptyText: { color: '#555', fontSize: 13 },
});
