import { useMemo, useRef, useState } from 'react';
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
  const [lastEvaluationResult, setLastEvaluationResult] =
    useState<BrowserEvaluationResult | null>(null);

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
    setProgress(0);
    setNavigationError(null);
    setTelemetryProtocolError(null);
    clearTelemetryState();
  };

  const handleTelemetryMessage = (message: BrowserBridgeMessage) => {
    registerTelemetryMessage(message);
  };

  const handleTelemetryProtocolError = (error: BrowserBridgeParseError) => {
    setTelemetryProtocolError(error);
  };

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
              <Text style={styles.eyebrow}>Issue #2 Browser Shell</Text>
              <Text style={styles.panelTitle}>Instrumentation Console</Text>
            </View>
            <View style={styles.panelPill}>
              <Text style={styles.panelPillText}>{frames.length} frame(s)</Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>Agent Goal</Text>
          <TextInput
            multiline
            onChangeText={setGoal}
            placeholder="Describe the browser task to run later."
            placeholderTextColor="#64748b"
            style={styles.goalInput}
            value={goal}
          />

          <View style={styles.buttonRow}>
            <DebugButton
              label={
                isRunningSmokeTest ? 'Running native stub...' : 'Run native stub'
              }
              onPress={handleNativeSmokeTest}
            />
            <DebugButton
              label={
                isRunningEvaluation
                  ? 'Evaluating page...'
                  : 'Evaluate page title'
              }
              onPress={handleEvaluatePageTitle}
            />
          </View>

          <View style={styles.statusGrid}>
            <StatusCard
              label="Loop state"
              value={loopState}
            />
            <StatusCard
              label="Telemetry"
              value={telemetryReady ? 'Untrusted events seen' : 'Pending'}
            />
            <StatusCard
              label="Current URL"
              value={currentUrl}
            />
            <StatusCard
              label="Requested source"
              value={requestedUrl}
            />
          </View>

          <StatusCard
            label="Last evaluation"
            value={formatValue(lastEvaluationResult)}
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
};

function DebugButton({ label, onPress }: DebugButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        pressed ? styles.primaryButtonPressed : null,
      ]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
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
    maxHeight: 360,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1f2937',
  },
  panelContent: {
    gap: 12,
    padding: 20,
  },
  panelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
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
  panelPill: {
    backgroundColor: '#082f49',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  panelPillText: {
    color: '#bae6fd',
    fontSize: 12,
    fontWeight: '700',
  },
  sectionLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  goalInput: {
    minHeight: 84,
    color: '#f8fafc',
    backgroundColor: '#111827',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: 'top',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#0ea5e9',
    borderRadius: 12,
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  primaryButtonPressed: {
    opacity: 0.85,
  },
  primaryButtonText: {
    color: '#082f49',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  statusGrid: {
    gap: 12,
  },
  statusCard: {
    backgroundColor: '#111827',
    borderRadius: 14,
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
  webviewFrame: {
    flex: 1,
    margin: 20,
    marginTop: 16,
    overflow: 'hidden',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#ffffff',
  },
});
