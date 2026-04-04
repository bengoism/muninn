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

import {
  DEFAULT_AGENT_RUNTIME_MODE,
  DEFAULT_LITERT_LM_SMOKE_TEST_PROMPT,
} from '../../../config/runtime';
import {
  downloadModel,
  getModelStatus,
  listAvailableModels,
  runInference,
  runLiteRTLMSmokeTest,
} from '../../../native/agent-runtime';
import { BottomPanel } from '../components/BottomPanel';
import { GoalBar } from '../components/GoalBar';
import { useAgentLoop } from '../loop/use-agent-loop';
import { useAgentSessionStore } from '../../../state/agent-session-store';
import { useBrowserStore } from '../../../state/browser-store';
import type {
  InferenceResponse,
  LiteRTLMSmokeTestResponse,
  ModelCatalogEntry,
  ModelStatus,
  ObservationResult,
  RuntimeMode,
} from '../../../types/agent';
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
  const modelDiagnosticsRefreshInFlightRef = useRef(false);

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

  const [isRunningEvaluation, setIsRunningEvaluation] = useState(false);
  const [isRunningObservation, setIsRunningObservation] = useState(false);
  const [lastEvaluationResult, setLastEvaluationResult] =
    useState<BrowserEvaluationResult | null>(null);
  const [lastObservationResult, setLastObservationResult] =
    useState<ObservationResult | null>(null);
  const [lastObservationError, setLastObservationError] = useState<string | null>(
    null
  );
  const [availableModels, setAvailableModels] = useState<ModelCatalogEntry[]>([]);
  const [isDownloadingModel, setIsDownloadingModel] = useState(false);
  const [isRefreshingModelDiagnostics, setIsRefreshingModelDiagnostics] =
    useState(false);
  const [isRunningLiteRTLMSmokeTest, setIsRunningLiteRTLMSmokeTest] =
    useState(false);
  const [lastLiteRTLMSmokeTestResult, setLastLiteRTLMSmokeTestResult] =
    useState<LiteRTLMSmokeTestResponse | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(
    DEFAULT_AGENT_RUNTIME_MODE
  );
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const agentLoop = useAgentLoop(browserRef, runtimeMode);
  const stepCount = useAgentSessionStore((state) => state.stepCount);

  const frames = useMemo(() => Object.values(framesById), [framesById]);
  const primaryModel = availableModels[0] ?? null;
  const activeModel = useMemo(
    () => availableModels.find((model) => model.active) ?? null,
    [availableModels]
  );
  const hasDownloadedModel = useMemo(
    () => availableModels.some((model) => model.downloaded),
    [availableModels]
  );

  const refreshModelDiagnostics = useCallback(async () => {
    if (modelDiagnosticsRefreshInFlightRef.current) {
      return;
    }

    try {
      modelDiagnosticsRefreshInFlightRef.current = true;
      setIsRefreshingModelDiagnostics(true);

      const [nextAvailableModels, nextModelStatus] = await Promise.all([
        listAvailableModels(),
        getModelStatus(),
      ]);

      setAvailableModels(nextAvailableModels);
      setModelStatus(nextModelStatus);
    } catch (error) {
      setModelStatus((current) =>
        buildModelStatusError(
          error instanceof Error
            ? error.message
            : 'Model diagnostics could not be refreshed.',
          current
        )
      );
    } finally {
      modelDiagnosticsRefreshInFlightRef.current = false;
      setIsRefreshingModelDiagnostics(false);
    }
  }, []);

  const handleDownloadModel = useCallback(async () => {
    if (!primaryModel) {
      return;
    }

    try {
      setIsDownloadingModel(true);
      const nextStatus = await downloadModel(primaryModel.id);
      setModelStatus(nextStatus);
      await refreshModelDiagnostics();
    } catch (error) {
      setModelStatus((current) =>
        buildModelStatusError(
          error instanceof Error ? error.message : 'Model download failed.',
          current
        )
      );
    } finally {
      setIsDownloadingModel(false);
    }
  }, [primaryModel, refreshModelDiagnostics]);

  const handleRunLiteRTLMSmokeTest = useCallback(async () => {
    try {
      setIsRunningLiteRTLMSmokeTest(true);
      const response = await runLiteRTLMSmokeTest(
        DEFAULT_LITERT_LM_SMOKE_TEST_PROMPT
      );
      setLastLiteRTLMSmokeTestResult(response);
    } catch (error) {
      setLastLiteRTLMSmokeTestResult({
        ok: false,
        code: 'internal_error',
        message:
          error instanceof Error
            ? error.message
            : 'LiteRT-LM smoke test failed unexpectedly.',
        details: null,
        retryable: false,
        backend: 'bridge',
      });
    } finally {
      setIsRunningLiteRTLMSmokeTest(false);
    }
  }, []);

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

  useEffect(() => {
    void refreshModelDiagnostics();
  }, [refreshModelDiagnostics]);

  useEffect(() => {
    if (!showDiagnostics && !modelStatus?.isDownloading) {
      return;
    }

    const intervalMs = modelStatus?.isDownloading ? 1_500 : 6_000;
    const interval = setInterval(() => {
      void refreshModelDiagnostics();
    }, intervalMs);

    return () => {
      clearInterval(interval);
    };
  }, [modelStatus?.isDownloading, refreshModelDiagnostics, showDiagnostics]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <SafeAreaView edges={['top', 'bottom']} style={styles.container}>
        <BrowserChrome
          telemetryReady={telemetryReady}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          currentUrl={currentUrl}
          isLoading={isLoading}
          modelName={activeModel?.displayName ?? null}
          onGoBack={() => browserRef.current?.goBack()}
          onGoForward={() => browserRef.current?.goForward()}
          onLoadFixture={() => setRequestedUrl(BRIDGE_FIXTURE_URL)}
          onReload={() => browserRef.current?.reload()}
          onSubmitUrl={setRequestedUrl}
          onToggleDiagnostics={() => setShowDiagnostics((v) => !v)}
          progress={progress}
          requestedUrl={requestedUrl}
          title={title}
        />

        <View style={{ flex: 1, position: 'relative' }}>
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
            {agentLoop.isRunning && <AgentOverlay loopState={loopState} />}
          </View>

          <BottomPanel
            onStart={(g) => agentLoop.start(g)}
            onCancel={agentLoop.cancel}
            isRunning={agentLoop.isRunning}
            modelReady={hasDownloadedModel}
            modelName={activeModel?.displayName ?? null}
          />
        </View>

        {showDiagnostics && (
        <ScrollView
          contentContainerStyle={styles.panelContent}
          keyboardShouldPersistTaps="handled"
          style={styles.diagnosticsPanel}
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

          <View style={styles.modelInstallCard}>
            <View style={styles.modelInstallCopy}>
              <Text style={styles.sectionLabel}>On-Device Model</Text>
              <Text style={styles.modelInstallTitle}>
                {formatSimpleModelStatusTitle({
                  activeModel,
                  hasDownloadedModel,
                  isDownloadingModel,
                  isRefreshing: isRefreshingModelDiagnostics,
                  modelStatus,
                  primaryModel,
                })}
              </Text>
              <Text style={styles.modelInstallSubtitle}>
                {formatSimpleModelStatusSubtitle({
                  activeModel,
                  hasDownloadedModel,
                  isDownloadingModel,
                  isRefreshing: isRefreshingModelDiagnostics,
                  modelStatus,
                  primaryModel,
                })}
              </Text>
            </View>

            {!hasDownloadedModel ? (
              <DebugButton
                disabled={
                  isDownloadingModel ||
                  modelStatus?.isDownloading === true ||
                  !primaryModel
                }
                label={
                  isDownloadingModel || modelStatus?.isDownloading
                    ? 'Downloading model...'
                    : primaryModel
                      ? `Download ${primaryModel.displayName}`
                      : isRefreshingModelDiagnostics
                        ? 'Checking models...'
                        : 'No downloadable model'
                }
                onPress={handleDownloadModel}
                tone="primary"
                wide
              />
            ) : null}
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
            {agentLoop.isRunning ? (
              <DebugButton
                label={`Cancel (step ${stepCount})`}
                onPress={agentLoop.cancel}
                tone="quiet"
              />
            ) : (
              <DebugButton
                label={`Start Agent (${formatRuntimeModeLabel(runtimeMode)})`}
                onPress={() => agentLoop.start(goal)}
                tone="quiet"
              />
            )}
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
              <View style={styles.statusCard}>
                <Text style={styles.statusCardLabel}>Runtime Controls</Text>
                <Text style={styles.sectionCaption}>
                  Toggle the inference backend and install the pinned Gemma 4
                  model for LiteRT-LM runs.
                </Text>
                <View style={styles.buttonRow}>
                  <DebugButton
                    label="Replay"
                    onPress={() => setRuntimeMode('replay')}
                    tone={runtimeMode === 'replay' ? 'primary' : 'secondary'}
                  />
                  <DebugButton
                    label="LiteRT-LM"
                    onPress={() => setRuntimeMode('litertlm')}
                    tone={runtimeMode === 'litertlm' ? 'primary' : 'secondary'}
                  />
                  <DebugButton
                    disabled={
                      isDownloadingModel ||
                      modelStatus?.isDownloading === true ||
                      !primaryModel
                    }
                    label={
                      isDownloadingModel || modelStatus?.isDownloading
                        ? 'Downloading model...'
                        : primaryModel
                          ? `Download ${primaryModel.displayName}`
                          : 'No downloadable model'
                    }
                    onPress={handleDownloadModel}
                    tone="quiet"
                    wide
                  />
                  <DebugButton
                    disabled={isRunningLiteRTLMSmokeTest}
                    label={
                      isRunningLiteRTLMSmokeTest
                        ? 'Running text smoke test...'
                        : 'Run LiteRT-LM text smoke test'
                    }
                    onPress={handleRunLiteRTLMSmokeTest}
                    tone="secondary"
                    wide
                  />
                </View>
              </View>
              <StatusCard
                label="Runtime mode"
                value={formatRuntimeModeStatus(
                  runtimeMode,
                  isRefreshingModelDiagnostics
                )}
              />
              <StatusCard
                label="Model catalog"
                value={formatModelCatalog(availableModels)}
              />
              <StatusCard
                label="Model status"
                value={formatModelStatus(modelStatus)}
              />
              <StatusCard
                label="LiteRT-LM smoke test prompt"
                value={DEFAULT_LITERT_LM_SMOKE_TEST_PROMPT}
              />
              <StatusCard
                label="Last LiteRT-LM smoke test"
                value={formatLiteRTLMSmokeTestResult(lastLiteRTLMSmokeTestResult)}
              />
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
        )}
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

type DebugButtonProps = {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'secondary' | 'quiet';
  wide?: boolean;
};

function DebugButton({
  disabled = false,
  label,
  onPress,
  tone = 'secondary',
  wide = false,
}: DebugButtonProps) {
  return (
    <Pressable
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.actionButton,
        tone === 'primary' ? styles.actionButtonPrimary : null,
        tone === 'secondary' ? styles.actionButtonSecondary : null,
        tone === 'quiet' ? styles.actionButtonQuiet : null,
        wide ? styles.actionButtonWide : null,
        disabled ? styles.actionButtonDisabled : null,
        pressed ? styles.actionButtonPressed : null,
      ]}
    >
      <Text
        style={[
          styles.actionButtonText,
          tone === 'primary' ? styles.actionButtonPrimaryText : null,
          tone === 'quiet' ? styles.actionButtonQuietText : null,
          disabled ? styles.actionButtonDisabledText : null,
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

function formatRuntimeModeLabel(runtimeMode: RuntimeMode) {
  return runtimeMode === 'litertlm' ? 'LiteRT-LM' : 'Replay';
}

function formatRuntimeModeStatus(
  runtimeMode: RuntimeMode,
  isRefreshing: boolean
) {
  if (!isRefreshing) {
    return `${formatRuntimeModeLabel(runtimeMode)} selected`;
  }

  return `${formatRuntimeModeLabel(runtimeMode)} selected\nRefreshing model diagnostics...`;
}

function formatSimpleModelStatusTitle(input: {
  activeModel: ModelCatalogEntry | null;
  hasDownloadedModel: boolean;
  isDownloadingModel: boolean;
  isRefreshing: boolean;
  modelStatus: ModelStatus | null;
  primaryModel: ModelCatalogEntry | null;
}) {
  if (input.isDownloadingModel || input.modelStatus?.isDownloading) {
    return 'Downloading Gemma 4 E2B';
  }

  if (input.hasDownloadedModel) {
    return input.activeModel
      ? `${input.activeModel.displayName} is installed`
      : 'A model is installed';
  }

  if (input.isRefreshing && input.modelStatus === null) {
    return 'Checking installed models';
  }

  if (input.primaryModel) {
    return `${input.primaryModel.displayName} is not installed`;
  }

  return 'No model available';
}

function formatSimpleModelStatusSubtitle(input: {
  activeModel: ModelCatalogEntry | null;
  hasDownloadedModel: boolean;
  isDownloadingModel: boolean;
  isRefreshing: boolean;
  modelStatus: ModelStatus | null;
  primaryModel: ModelCatalogEntry | null;
}) {
  if (input.isDownloadingModel || input.modelStatus?.isDownloading) {
    return `Downloading ${formatBytes(input.modelStatus?.downloadedBytes ?? 0)} of ${formatBytes(input.modelStatus?.totalBytes ?? input.primaryModel?.approximateSizeBytes ?? 0)}.`;
  }

  if (input.modelStatus?.lastError) {
    return input.modelStatus.lastError;
  }

  if (input.hasDownloadedModel) {
    if (input.activeModel) {
      return `Ready for LiteRT-LM runs. Active commit: ${input.activeModel.commitHash}.`;
    }

    return 'Ready for LiteRT-LM runs.';
  }

  if (input.isRefreshing && input.modelStatus === null) {
    return 'Checking app storage for previously downloaded models.';
  }

  if (input.primaryModel) {
    return `Download the pinned on-device model once, then use it for local LiteRT-LM runs. Size: ${formatBytes(input.primaryModel.approximateSizeBytes)}.`;
  }

  return 'This runtime does not currently expose a downloadable model.';
}

function formatModelCatalog(models: ModelCatalogEntry[]) {
  if (models.length === 0) {
    return 'No downloadable models are exposed by this runtime.';
  }

  return models
    .map((model) =>
      [
        model.displayName,
        `id=${model.id}`,
        model.active ? 'active' : 'inactive',
        model.downloaded ? 'downloaded' : 'not-downloaded',
        `size=${formatBytes(model.approximateSizeBytes)}`,
      ].join(' | ')
    )
    .join('\n');
}

function formatModelStatus(status: ModelStatus | null) {
  if (!status) {
    return 'Not fetched';
  }

  return [
    `activeModelId=${status.activeModelId ?? 'None'}`,
    `activeCommitHash=${status.activeCommitHash ?? 'None'}`,
    `isDownloading=${status.isDownloading ? 'yes' : 'no'}`,
    `downloadedBytes=${formatBytes(status.downloadedBytes)}`,
    `totalBytes=${formatBytes(status.totalBytes)}`,
    `lastError=${status.lastError ?? 'None'}`,
  ].join('\n');
}

function formatLiteRTLMSmokeTestResult(
  result: LiteRTLMSmokeTestResponse | null
) {
  if (!result) {
    return 'Not run';
  }

  if (!result.ok) {
    return [
      `failure=${result.code}`,
      `backend=${result.backend}`,
      `message=${result.message}`,
      `details=${formatValue(result.details)}`,
    ].join('\n');
  }

  return [
    `backend=${result.backend}`,
    `text=${result.text}`,
    `diagnostics=${formatValue(result.diagnostics)}`,
  ].join('\n');
}

function AgentOverlay({ loopState }: { loopState: string }) {
  const label =
    loopState === 'observing' ? 'Looking at page' :
    loopState === 'reasoning' ? 'Thinking' :
    loopState === 'acting' ? 'Acting' :
    loopState === 'validating' ? 'Checking' :
    loopState === 'retrying' ? 'Retrying' :
    null;

  if (!label) return null;

  return (
    <View style={styles.agentOverlay}>
      <View style={styles.agentOverlayPill}>
        <View style={styles.agentOverlayDot} />
        <Text style={styles.agentOverlayText}>{label}</Text>
      </View>
    </View>
  );
}

function buildModelStatusError(
  message: string,
  current: ModelStatus | null
): ModelStatus {
  return {
    activeModelId: current?.activeModelId ?? null,
    activeCommitHash: current?.activeCommitHash ?? null,
    isDownloading: current?.isDownloading ?? false,
    downloadedBytes: current?.downloadedBytes ?? 0,
    totalBytes: current?.totalBytes ?? 0,
    lastError: message,
  };
}

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let value = bytes;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function mapResponseToLoopState(response: InferenceResponse) {
  if (!response.ok) {
    return 'failed' as const;
  }

  if (response.action === 'yield_to_user') {
    return 'yielded' as const;
  }

  if (response.action === 'finish') {
    return 'finished' as const;
  }

  return 'acting' as const;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  panel: {
    maxHeight: 292,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#17263b',
  },
  diagnosticsPanel: {
    maxHeight: 300,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#17263b',
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
  modelInstallCard: {
    backgroundColor: '#101927',
    borderColor: '#17263b',
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  modelInstallCopy: {
    gap: 6,
  },
  modelInstallTitle: {
    color: '#f8fafc',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  modelInstallSubtitle: {
    color: '#8ca0bd',
    fontSize: 12.5,
    lineHeight: 18,
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
  actionButtonDisabled: {
    opacity: 0.55,
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
  actionButtonDisabledText: {
    color: '#94a3b8',
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
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  agentOverlay: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
    pointerEvents: 'none',
  },
  agentOverlayPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  agentOverlayDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00d47e',
  },
  agentOverlayText: {
    color: '#ededed',
    fontSize: 12,
    fontWeight: '500',
  },
});
