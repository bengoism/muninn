import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { runInference } from '../../../native/agent-runtime';
import { useAgentSessionStore } from '../../../state/agent-session-store';
import { useBrowserStore } from '../../../state/browser-store';
import type { ObservationResult } from '../../../types/agent';
import { BrowserChrome } from '../components/BrowserChrome';
import {
  BrowserWebView,
  type BrowserWebViewHandle,
} from '../components/BrowserWebView';
import { BRIDGE_FIXTURE_URL } from '../fixtures/bridge-fixture';
import type {
  BrowserBridgeMessage,
  BrowserBridgeParseError,
  BrowserEvaluationResult,
} from '../types';

export function BrowserScreen() {
  const browserRef = useRef<BrowserWebViewHandle>(null);
  const autoObservationRequestedRef = useRef(false);

  const requestedUrl = useBrowserStore((state) => state.requestedUrl);
  const currentUrl = useBrowserStore((state) => state.currentUrl);
  const title = useBrowserStore((state) => state.title);
  const progress = useBrowserStore((state) => state.progress);
  const isLoading = useBrowserStore((state) => state.isLoading);
  const canGoBack = useBrowserStore((state) => state.canGoBack);
  const canGoForward = useBrowserStore((state) => state.canGoForward);
  const telemetryReady = useBrowserStore((state) => state.telemetryReady);
  const framesById = useBrowserStore((state) => state.frames);
  const lastNavigationError = useBrowserStore(
    (state) => state.lastNavigationError
  );
  const lastScriptError = useBrowserStore((state) => state.lastScriptError);
  const lastTelemetryProtocolError = useBrowserStore(
    (state) => state.lastTelemetryProtocolError
  );
  const lastTelemetryMessage = useBrowserStore(
    (state) => state.lastTelemetryMessage
  );
  const setRequestedUrl = useBrowserStore((state) => state.setRequestedUrl);
  const applyNavigationState = useBrowserStore(
    (state) => state.applyNavigationState
  );
  const setProgress = useBrowserStore((state) => state.setProgress);
  const setNavigationError = useBrowserStore(
    (state) => state.setNavigationError
  );
  const clearTelemetryState = useBrowserStore(
    (state) => state.clearTelemetryState
  );
  const registerTelemetryMessage = useBrowserStore(
    (state) => state.registerTelemetryMessage
  );
  const setTelemetryProtocolError = useBrowserStore(
    (state) => state.setTelemetryProtocolError
  );

  const goal = useAgentSessionStore((state) => state.goal);
  const loopState = useAgentSessionStore((state) => state.loopState);
  const lastNativeResponse = useAgentSessionStore(
    (state) => state.lastNativeResponse
  );
  const lastAgentError = useAgentSessionStore((state) => state.lastError);
  const setGoal = useAgentSessionStore((state) => state.setGoal);
  const setLoopState = useAgentSessionStore((state) => state.setLoopState);
  const setLastNativeResponse = useAgentSessionStore(
    (state) => state.setLastNativeResponse
  );
  const setLastAgentError = useAgentSessionStore((state) => state.setLastError);

  const [isRunningSmokeTest, setIsRunningSmokeTest] = useState(false);
  const [isRunningEvaluation, setIsRunningEvaluation] = useState(false);
  const [isRunningObservation, setIsRunningObservation] = useState(false);
  const [lastEvaluationResult, setLastEvaluationResult] =
    useState<BrowserEvaluationResult | null>(null);
  const [lastObservationResult, setLastObservationResult] =
    useState<ObservationResult | null>(null);
  const [lastObservationError, setLastObservationError] = useState<string | null>(
    null
  );
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const frames = useMemo(() => Object.values(framesById), [framesById]);

  const handleNativeSmokeTest = async () => {
    try {
      setIsRunningSmokeTest(true);
      setLoopState('reasoning');
      setLastAgentError(null);

      const response = await runInference({
        goal,
        screenshotUri: 'file:///bootstrap-smoke-screenshot.png',
        axSnapshot: [],
        actionHistory: [],
      });

      setLastNativeResponse(response);
      setLoopState(mapResponseToLoopState(response.action));
    } catch (error) {
      setLoopState('failed');
      setLastNativeResponse(null);
      setLastAgentError(
        error instanceof Error ? error.message : 'Native smoke test failed.'
      );
    } finally {
      setIsRunningSmokeTest(false);
    }
  };

  const handleEvaluatePageTitle = async () => {
    try {
      setIsRunningEvaluation(true);

      const result = await browserRef.current?.evaluateJavaScript<{
        readyState: string;
        title: string;
        url: string;
      }>(
        `({
          title: document.title,
          url: window.location.href,
          readyState: document.readyState
        })`
      );

      setLastEvaluationResult(
        result ?? {
          ok: false,
          requestId: 'browser-host-missing',
          type: 'native_unavailable',
          message: 'Browser host ref was unavailable.',
          elapsedMs: 0,
        }
      );
    } finally {
      setIsRunningEvaluation(false);
    }
  };

  const handleBrowserLoadStart = () => {
    autoObservationRequestedRef.current = false;
    setProgress(0);
    setNavigationError(null);
    setLastObservationError(null);
    setLastObservationResult(null);
    setTelemetryProtocolError(null);
    clearTelemetryState();
  };

  const handleObservePage = useCallback(async () => {
    try {
      setIsRunningObservation(true);
      setLastObservationError(null);
      setLoopState('observing');

      const result = await browserRef.current?.observe();

      if (!result) {
        throw new Error('Browser host ref was unavailable.');
      }

      setLastObservationResult(result);
      setLoopState('idle');
    } catch (error) {
      setLastObservationError(
        error instanceof Error ? error.message : 'Observation failed.'
      );
      setLoopState('failed');
    } finally {
      setIsRunningObservation(false);
    }
  }, [setLoopState]);

  const handleTelemetryMessage = (message: BrowserBridgeMessage) => {
    registerTelemetryMessage(message);
  };

  const handleTelemetryProtocolError = (error: BrowserBridgeParseError) => {
    setTelemetryProtocolError(error);
  };

  useEffect(() => {
    if (
      requestedUrl !== BRIDGE_FIXTURE_URL ||
      !telemetryReady ||
      isLoading ||
      isRunningObservation ||
      lastObservationResult ||
      lastObservationError ||
      autoObservationRequestedRef.current
    ) {
      return;
    }

    autoObservationRequestedRef.current = true;
    void handleObservePage();
  }, [
    handleObservePage,
    isLoading,
    isRunningObservation,
    lastObservationError,
    lastObservationResult,
    requestedUrl,
    telemetryReady,
  ]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <SafeAreaView edges={['top']} style={styles.container}>
        <BrowserChrome
          telemetryReady={telemetryReady}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          currentUrl={currentUrl}
          isLoading={isLoading}
          onGoBack={() => browserRef.current?.goBack()}
          onGoForward={() => browserRef.current?.goForward()}
          onLoadFixture={() => setRequestedUrl(BRIDGE_FIXTURE_URL)}
          onReload={() => browserRef.current?.reload()}
          onSubmitUrl={setRequestedUrl}
          progress={progress}
          requestedUrl={requestedUrl}
          title={title}
        />

        <ScrollView
          contentContainerStyle={styles.panelContent}
          keyboardShouldPersistTaps="handled"
          style={styles.panel}
        >
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.eyebrow}>Issue #3 Observation Pipeline</Text>
              <Text style={styles.panelTitle}>Observation Console</Text>
              <Text style={styles.panelSubtitle}>
                Keep the browser visible while checking loop, telemetry, and
                observation health.
              </Text>
            </View>
            <View style={styles.panelPill}>
              <Text style={styles.panelPillText}>{frames.length} frame(s)</Text>
            </View>
          </View>

          <View style={styles.goalSection}>
            <Text style={styles.sectionLabel}>Agent Goal</Text>
            <TextInput
              multiline
              onChangeText={setGoal}
              placeholder="Describe the browser task to run later."
              placeholderTextColor="#64748b"
              style={styles.goalInput}
              value={goal}
            />
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>Quick Actions</Text>
            <Text style={styles.sectionCaption}>
              Fixture observations auto-run once telemetry is ready.
            </Text>
          </View>

          <View style={styles.buttonRow}>
            <DebugButton
              label={
                isRunningObservation ? 'Observing page...' : 'Observe page'
              }
              onPress={handleObservePage}
              tone="primary"
            />
            <DebugButton
              label={
                isRunningEvaluation
                  ? 'Evaluating page...'
                  : 'Evaluate page title'
              }
              onPress={handleEvaluatePageTitle}
              tone="secondary"
            />
            <DebugButton
              label={
                isRunningSmokeTest ? 'Running native stub...' : 'Run native stub'
              }
              onPress={handleNativeSmokeTest}
              tone="quiet"
            />
          </View>

          <View style={styles.summaryGrid}>
            <SummaryCard
              label="Loop State"
              meta={currentUrl}
              value={formatLoopState(loopState)}
            />
            <SummaryCard
              label="Observation"
              meta={formatObservationMetricMeta({
                isRunningObservation,
                lastObservationError,
                lastObservationResult,
              })}
              value={formatObservationMetricValue({
                isRunningObservation,
                lastObservationError,
                lastObservationResult,
              })}
            />
            <SummaryCard
              label="Quiescence"
              meta={formatQuiescenceMetricMeta(lastObservationResult)}
              value={formatQuiescenceMetricValue(lastObservationResult)}
            />
            <SummaryCard
              label="Telemetry"
              meta={`${frames.length} frame(s) tracked`}
              value={telemetryReady ? 'Active' : 'Pending'}
            />
          </View>

          <StatusCard
            label="Latest observation"
            value={formatObservationSummary(lastObservationResult)}
          />

          <Pressable
            onPress={() => setShowDiagnostics((current) => !current)}
            style={({ pressed }) => [
              styles.diagnosticsToggle,
              pressed ? styles.diagnosticsTogglePressed : null,
            ]}
          >
            <View style={styles.diagnosticsToggleCopy}>
              <Text style={styles.sectionLabel}>Detailed Diagnostics</Text>
              <Text style={styles.diagnosticsToggleHint}>
                Expanded logs for evaluation, protocol, navigation, and native
                responses.
              </Text>
            </View>
            <Text style={styles.diagnosticsToggleText}>
              {showDiagnostics ? 'Hide' : 'Show'}
            </Text>
          </Pressable>

          {showDiagnostics ? (
            <View style={styles.detailStack}>
              <StatusCard
                label="Requested source"
                value={requestedUrl}
              />
              <StatusCard
                label="Last evaluation"
                value={formatValue(lastEvaluationResult)}
              />
              <StatusCard
                label="Observation screenshot"
                value={lastObservationResult?.screenshot.uri ?? 'None'}
              />
              <StatusCard
                label="Observation warnings"
                value={formatObservationWarnings(lastObservationResult)}
              />
              <StatusCard
                label="Last observation error"
                value={lastObservationError ?? 'None'}
              />
              <StatusCard
                label="Last telemetry message"
                value={formatValue(lastTelemetryMessage)}
              />
              <StatusCard
                label="Last script error"
                value={formatValue(lastScriptError)}
              />
              <StatusCard
                label="Last telemetry protocol error"
                value={formatValue(lastTelemetryProtocolError)}
              />
              <StatusCard
                label="Last navigation error"
                value={formatValue(lastNavigationError)}
              />
              <StatusCard
                label="Last native response"
                value={formatValue(lastNativeResponse)}
              />
              <StatusCard
                label="Last agent error"
                value={lastAgentError ?? 'None'}
              />
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.webviewFrame}>
          <BrowserWebView
            onLoadStart={handleBrowserLoadStart}
            onNavigationError={setNavigationError}
            onNavigationStateChange={applyNavigationState}
            onProgressChange={setProgress}
            onTelemetryMessage={handleTelemetryMessage}
            onTelemetryProtocolError={handleTelemetryProtocolError}
            ref={browserRef}
            requestedUrl={requestedUrl}
          />
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

type DebugButtonProps = {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'secondary' | 'quiet';
  wide?: boolean;
};

function DebugButton({
  label,
  onPress,
  tone = 'secondary',
  wide = false,
}: DebugButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        tone === 'primary' ? styles.actionButtonPrimary : null,
        tone === 'secondary' ? styles.actionButtonSecondary : null,
        tone === 'quiet' ? styles.actionButtonQuiet : null,
        wide ? styles.actionButtonWide : null,
        pressed ? styles.actionButtonPressed : null,
      ]}
    >
      <Text
        style={[
          styles.actionButtonText,
          tone === 'primary' ? styles.actionButtonPrimaryText : null,
          tone === 'quiet' ? styles.actionButtonQuietText : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

type SummaryCardProps = {
  label: string;
  meta: string;
  value: string;
};

function SummaryCard({ label, meta, value }: SummaryCardProps) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryCardLabel}>{label}</Text>
      <Text numberOfLines={2} style={styles.summaryCardValue}>
        {value}
      </Text>
      <Text numberOfLines={2} style={styles.summaryCardMeta}>
        {meta}
      </Text>
    </View>
  );
}

type StatusCardProps = {
  label: string;
  value: string;
};

function StatusCard({ label, value }: StatusCardProps) {
  return (
    <View style={styles.statusCard}>
      <Text style={styles.statusCardLabel}>{label}</Text>
      <Text style={styles.statusCardValue}>{value}</Text>
    </View>
  );
}

function formatValue(value: unknown) {
  if (value === null || value === undefined) {
    return 'None';
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function formatObservationSummary(result: ObservationResult | null) {
  if (!result) {
    return 'None';
  }

  return [
    `${result.axSnapshot.length} node(s)`,
    `${result.frameSnapshots.length} frame(s)`,
    `${result.screenshot.width}x${result.screenshot.height} px`,
    `quiescence ${result.quiescence.waitTimeMs} ms`,
  ].join(' | ');
}

function formatObservationWarnings(result: ObservationResult | null) {
  if (!result || result.warnings.length === 0) {
    return 'None';
  }

  return result.warnings.join('\n');
}

function formatLoopState(loopState: string) {
  return loopState
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function formatObservationMetricValue(input: {
  isRunningObservation: boolean;
  lastObservationError: string | null;
  lastObservationResult: ObservationResult | null;
}) {
  if (input.isRunningObservation) {
    return 'Running';
  }

  if (input.lastObservationError) {
    return 'Failed';
  }

  if (!input.lastObservationResult) {
    return 'Idle';
  }

  return `${input.lastObservationResult.axSnapshot.length} nodes`;
}

function formatObservationMetricMeta(input: {
  isRunningObservation: boolean;
  lastObservationError: string | null;
  lastObservationResult: ObservationResult | null;
}) {
  if (input.isRunningObservation) {
    return 'Collecting snapshot and frame data';
  }

  if (input.lastObservationError) {
    return input.lastObservationError;
  }

  if (!input.lastObservationResult) {
    return 'No observation captured yet';
  }

  return `${input.lastObservationResult.frameSnapshots.length} frame(s) | ${input.lastObservationResult.warnings.length} warning(s)`;
}

function formatQuiescenceMetricValue(result: ObservationResult | null) {
  if (!result) {
    return 'Not run';
  }

  return `${result.quiescence.waitTimeMs} ms`;
}

function formatQuiescenceMetricMeta(result: ObservationResult | null) {
  if (!result) {
    return 'Awaiting first observation pass';
  }

  return `${result.quiescence.observedFrameCount} frame(s) idle before capture`;
}

function mapResponseToLoopState(action: string) {
  if (action === 'yield_to_user') {
    return 'yielded' as const;
  }

  if (action === 'finish') {
    return 'finished' as const;
  }

  return 'acting' as const;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0b1117',
  },
  container: {
    flex: 1,
    backgroundColor: '#0b1117',
  },
  panel: {
    maxHeight: 292,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#17263b',
  },
  panelContent: {
    gap: 10,
    padding: 14,
  },
  panelHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  eyebrow: {
    color: '#7dd3fc',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  panelTitle: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '800',
    marginTop: 4,
  },
  panelSubtitle: {
    color: '#8ca0bd',
    fontSize: 12.5,
    lineHeight: 17,
    marginTop: 4,
    maxWidth: 260,
  },
  panelPill: {
    alignSelf: 'center',
    backgroundColor: '#0d3050',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  panelPillText: {
    color: '#bae6fd',
    fontSize: 12,
    fontWeight: '700',
  },
  goalSection: {
    backgroundColor: '#101927',
    borderColor: '#17263b',
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 10,
  },
  sectionHeader: {
    gap: 4,
  },
  sectionLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sectionCaption: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 16,
  },
  goalInput: {
    minHeight: 60,
    color: '#f8fafc',
    backgroundColor: '#0c1524',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    textAlignVertical: 'top',
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: 16,
    flexGrow: 1,
    minHeight: 50,
    minWidth: 92,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  actionButtonWide: {
    minWidth: '100%',
  },
  actionButtonPrimary: {
    backgroundColor: '#38bdf8',
  },
  actionButtonSecondary: {
    backgroundColor: '#142235',
    borderColor: '#1f344d',
    borderWidth: 1,
  },
  actionButtonQuiet: {
    backgroundColor: '#101927',
    borderColor: '#17263b',
    borderWidth: 1,
  },
  actionButtonPressed: {
    opacity: 0.85,
  },
  actionButtonText: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  actionButtonPrimaryText: {
    color: '#082f49',
  },
  actionButtonQuietText: {
    color: '#cbd5e1',
  },
  statusGrid: {
    gap: 12,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryCard: {
    backgroundColor: '#101927',
    borderColor: '#17263b',
    borderRadius: 18,
    borderWidth: 1,
    flexGrow: 1,
    gap: 8,
    minHeight: 110,
    minWidth: 145,
    padding: 14,
  },
  summaryCardLabel: {
    color: '#7dd3fc',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  summaryCardValue: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 24,
  },
  summaryCardMeta: {
    color: '#8ca0bd',
    fontSize: 12,
    lineHeight: 16,
  },
  statusCard: {
    backgroundColor: '#101927',
    borderColor: '#17263b',
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  statusCardLabel: {
    color: '#7dd3fc',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  statusCardValue: {
    color: '#e2e8f0',
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    fontSize: 12,
  },
  diagnosticsToggle: {
    alignItems: 'center',
    backgroundColor: '#101927',
    borderColor: '#17263b',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    padding: 14,
  },
  diagnosticsTogglePressed: {
    opacity: 0.86,
  },
  diagnosticsToggleCopy: {
    flex: 1,
    gap: 4,
  },
  diagnosticsToggleHint: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 16,
  },
  diagnosticsToggleText: {
    color: '#bae6fd',
    fontSize: 13,
    fontWeight: '800',
  },
  detailStack: {
    gap: 10,
  },
  webviewFrame: {
    flex: 1,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 16,
    overflow: 'hidden',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#17263b',
    backgroundColor: '#ffffff',
  },
});
