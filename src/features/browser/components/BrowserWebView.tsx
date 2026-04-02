import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { StyleSheet, View } from 'react-native';

import type {
  ObservationQuiescence,
  ObservationResult,
  ViewportCapture,
} from '../../../types/agent';
import {
  BrowserHostView,
  type BrowserHostEvaluationOutcome,
  type BrowserHostViewportCaptureOutcome,
  type BrowserHostViewHandle as NativeBrowserHostViewHandle,
} from '../../../native/browser-host';
import {
  buildBridgeAfterContentScript,
  buildBridgeBootstrapScript,
} from '../bridge/bootstrap';
import { stitchObservationArtifacts } from '../observation/stitching';
import { parseBrowserBridgeMessage } from '../bridge/protocol';
import type {
  BrowserAxSnapshotErrorMessage,
  BrowserAxSnapshotMessage,
  BrowserBridgeMessage,
  BrowserBridgeParseError,
  BrowserEvaluationFailure,
  BrowserEvaluationResult,
  BrowserFrameLinkPayload,
  BrowserFrameMetadata,
  BrowserNavigationError,
  BrowserNavigationStateSnapshot,
  BrowserObservationStateMessage,
} from '../types';
import { resolveBrowserSource } from '../utils/url';

type BrowserWebViewProps = {
  requestedUrl: string;
  onLoadStart?: () => void;
  onNavigationError?: (error: BrowserNavigationError) => void;
  onNavigationStateChange?: (
    navigationState: BrowserNavigationStateSnapshot
  ) => void;
  onProgressChange?: (progress: number) => void;
  onTelemetryMessage?: (message: BrowserBridgeMessage) => void;
  onTelemetryProtocolError?: (error: BrowserBridgeParseError) => void;
};

export type BrowserWebViewHandle = {
  captureViewport: () => Promise<ViewportCapture>;
  evaluateJavaScript: <T = unknown>(
    source: string,
    options?: {
      timeoutMs?: number;
    }
  ) => Promise<BrowserEvaluationResult<T>>;
  observe: (options?: {
    idleThresholdMs?: number;
    quiescenceTimeoutMs?: number;
    snapshotTimeoutMs?: number;
  }) => Promise<ObservationResult>;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  stopLoading: () => void;
};

type PendingEvaluation = {
  resolve: (result: BrowserEvaluationResult) => void;
  startedAt: number;
  timeoutId: ReturnType<typeof setTimeout>;
};

type PendingObservationRequest = {
  errors: Map<string, BrowserAxSnapshotErrorMessage>;
  expectedFrameIds: Set<string>;
  reject: (error: Error) => void;
  resolve: (result: ObservationCollectionResult) => void;
  responses: Map<string, BrowserAxSnapshotMessage>;
  settleTimeoutId: ReturnType<typeof setTimeout> | null;
  startedAt: number;
  timeoutId: ReturnType<typeof setTimeout>;
};

type ObservationCollectionResult = {
  elapsedMs: number;
  errors: BrowserAxSnapshotErrorMessage[];
  expectedFrameIds: string[];
  responses: BrowserAxSnapshotMessage[];
  timedOut: boolean;
};

const BRIDGE_BOOTSTRAP_SCRIPT = buildBridgeBootstrapScript();
const BRIDGE_AFTER_CONTENT_SCRIPT = buildBridgeAfterContentScript();

export const BrowserWebView = forwardRef<BrowserWebViewHandle, BrowserWebViewProps>(
  function BrowserWebView(
    {
      requestedUrl,
      onLoadStart,
      onNavigationError,
      onNavigationStateChange,
      onProgressChange,
      onTelemetryMessage,
      onTelemetryProtocolError,
    },
    ref
  ) {
    const hostRef = useRef<NativeBrowserHostViewHandle>(null);
    const mainTelemetryFrameRef = useRef<BrowserFrameMetadata | null>(null);
    const navigationStateRef = useRef<BrowserNavigationStateSnapshot | null>(null);
    const observationStatesByFrameRef = useRef<
      Map<string, BrowserObservationStateMessage>
    >(new Map());
    const frameLinksRef = useRef<Map<string, BrowserFrameLinkPayload>>(new Map());
    const pendingEvaluationsRef = useRef<Map<string, PendingEvaluation>>(new Map());
    const pendingObservationRequestsRef = useRef<
      Map<string, PendingObservationRequest>
    >(new Map());
    const requestIdRef = useRef(0);

    const source = useMemo(
      () => resolveBrowserSource(requestedUrl),
      [requestedUrl]
    );

    const resolvePendingEvaluation = useCallback(
      (requestId: string, result: BrowserEvaluationResult) => {
        const pending = pendingEvaluationsRef.current.get(requestId);

        if (!pending) {
          return;
        }

        clearTimeout(pending.timeoutId);
        pendingEvaluationsRef.current.delete(requestId);
        pending.resolve(result);
      },
      []
    );

    const failPendingEvaluations = useCallback(
      (
        type: BrowserEvaluationFailure['type'],
        message: string,
        details?: unknown
      ) => {
        const pendingEvaluations = Array.from(pendingEvaluationsRef.current.entries());
        pendingEvaluationsRef.current.clear();

        pendingEvaluations.forEach(([requestId, pending]) => {
          clearTimeout(pending.timeoutId);

          pending.resolve({
            ok: false,
            requestId,
            type,
            message,
            details,
            elapsedMs: Date.now() - pending.startedAt,
          });
        });
      },
      []
    );

    const finalizeObservationRequest = useCallback(
      (requestId: string, timedOut: boolean) => {
        const pending = pendingObservationRequestsRef.current.get(requestId);

        if (!pending) {
          return;
        }

        clearTimeout(pending.timeoutId);
        if (pending.settleTimeoutId) {
          clearTimeout(pending.settleTimeoutId);
        }
        pendingObservationRequestsRef.current.delete(requestId);
        pending.resolve({
          elapsedMs: Date.now() - pending.startedAt,
          errors: Array.from(pending.errors.values()),
          expectedFrameIds: Array.from(pending.expectedFrameIds),
          responses: Array.from(pending.responses.values()),
          timedOut,
        });
      },
      []
    );

    const maybeSettleObservationRequest = useCallback(
      (requestId: string) => {
        const pending = pendingObservationRequestsRef.current.get(requestId);

        if (!pending) {
          return;
        }

        const seenFrameIds = new Set([
          ...pending.responses.keys(),
          ...pending.errors.keys(),
        ]);
        const hasSeenExpectedFrames =
          pending.expectedFrameIds.size > 0 &&
          Array.from(pending.expectedFrameIds).every((frameId) =>
            seenFrameIds.has(frameId)
          );

        if (!hasSeenExpectedFrames) {
          return;
        }

        if (pending.settleTimeoutId) {
          clearTimeout(pending.settleTimeoutId);
        }

        pending.settleTimeoutId = setTimeout(() => {
          finalizeObservationRequest(requestId, false);
        }, 120);
      },
      [finalizeObservationRequest]
    );

    const failPendingObservationRequests = useCallback((message: string) => {
      const pendingRequests = Array.from(
        pendingObservationRequestsRef.current.entries()
      );
      pendingObservationRequestsRef.current.clear();

      pendingRequests.forEach(([, pending]) => {
        clearTimeout(pending.timeoutId);
        if (pending.settleTimeoutId) {
          clearTimeout(pending.settleTimeoutId);
        }
        pending.reject(new Error(message));
      });
    }, []);

    const handleLoadStart = useCallback(() => {
      mainTelemetryFrameRef.current = null;
      navigationStateRef.current = null;
      observationStatesByFrameRef.current.clear();
      frameLinksRef.current.clear();
      failPendingEvaluations(
        'navigation_changed',
        'Page navigation interrupted pending evaluation.'
      );
      failPendingObservationRequests(
        'Page navigation interrupted the active observation request.'
      );
      onLoadStart?.();
    }, [failPendingEvaluations, failPendingObservationRequests, onLoadStart]);

    const handleTelemetryMessage = useCallback(
      (rawMessage: string) => {
        const parsedMessage = parseBrowserBridgeMessage(rawMessage);

        if (!parsedMessage) {
          return;
        }

        if ('type' in parsedMessage) {
          onTelemetryProtocolError?.(parsedMessage);
          return;
        }

        if (
          parsedMessage.kind === 'bridge_ready' &&
          parsedMessage.frame.isTopFrame
        ) {
          mainTelemetryFrameRef.current = parsedMessage.frame;
        }

        if (parsedMessage.kind === 'observation_state') {
          observationStatesByFrameRef.current.set(
            parsedMessage.frame.frameId,
            parsedMessage
          );
        }

        if (parsedMessage.kind === 'frame_link') {
          frameLinksRef.current.set(
            parsedMessage.payload.childFrameId,
            parsedMessage.payload
          );
        }

        if (parsedMessage.kind === 'ax_snapshot') {
          const pendingRequest = pendingObservationRequestsRef.current.get(
            parsedMessage.payload.requestId
          );

          if (pendingRequest) {
            pendingRequest.responses.set(parsedMessage.frame.frameId, parsedMessage);
            maybeSettleObservationRequest(parsedMessage.payload.requestId);
          }
        }

        if (parsedMessage.kind === 'ax_snapshot_error') {
          const pendingRequest = pendingObservationRequestsRef.current.get(
            parsedMessage.payload.requestId
          );

          if (pendingRequest) {
            pendingRequest.errors.set(parsedMessage.frame.frameId, parsedMessage);
            maybeSettleObservationRequest(parsedMessage.payload.requestId);
          }
        }

        onTelemetryMessage?.(parsedMessage);
      },
      [maybeSettleObservationRequest, onTelemetryMessage, onTelemetryProtocolError]
    );

    const captureViewport = useCallback(async () => {
      if (!hostRef.current) {
        throw new Error('The native browser host is not mounted.');
      }

      const result: BrowserHostViewportCaptureOutcome =
        await hostRef.current.captureViewport();

      if (result.ok) {
        return result.capture;
      }

      throw new Error(result.message);
    }, []);

    const waitForQuiescence = useCallback(
      async (options?: {
        idleThresholdMs?: number;
        quiescenceTimeoutMs?: number;
      }) => {
        const idleThresholdMs = options?.idleThresholdMs ?? 500;
        const quiescenceTimeoutMs = options?.quiescenceTimeoutMs ?? 4000;
        const startedAt = Date.now();

        return new Promise<ObservationQuiescence>((resolve) => {
          const tick = () => {
            const navigationState = navigationStateRef.current;
            const observationStates = Array.from(
              observationStatesByFrameRef.current.values()
            );
            const lastActivityAt =
              observationStates
                .map((message) => Date.parse(message.payload.lastActivityAt))
                .filter((timestamp) => Number.isFinite(timestamp))
                .sort((left, right) => right - left)[0] ?? null;
            const idleForMs =
              lastActivityAt === null ? 0 : Date.now() - lastActivityAt;
            const pendingRequestCount = observationStates.reduce(
              (total, message) => total + message.payload.pendingRequestCount,
              0
            );
            const satisfied =
              Boolean(navigationState) &&
              navigationState?.isLoading === false &&
              observationStates.length > 0 &&
              pendingRequestCount === 0 &&
              idleForMs >= idleThresholdMs;

            if (satisfied) {
              resolve({
                idleThresholdMs,
                lastActivityAt:
                  lastActivityAt === null
                    ? null
                    : new Date(lastActivityAt).toISOString(),
                observedFrameCount: observationStates.length,
                satisfied: true,
                timedOut: false,
                waitTimeMs: Date.now() - startedAt,
              });
              return;
            }

            if (Date.now() - startedAt >= quiescenceTimeoutMs) {
              resolve({
                idleThresholdMs,
                lastActivityAt:
                  lastActivityAt === null
                    ? null
                    : new Date(lastActivityAt).toISOString(),
                observedFrameCount: observationStates.length,
                satisfied: false,
                timedOut: true,
                waitTimeMs: Date.now() - startedAt,
              });
              return;
            }

            setTimeout(tick, 100);
          };

          tick();
        });
      },
      []
    );

    const requestObservationSnapshots = useCallback(
      async (timeoutMs: number) => {
        const expectedFrameIds = new Set<string>([
          ...observationStatesByFrameRef.current.keys(),
          ...frameLinksRef.current.keys(),
        ]);

        if (mainTelemetryFrameRef.current) {
          expectedFrameIds.add(mainTelemetryFrameRef.current.frameId);
        }

        if (!hostRef.current) {
          throw new Error('The native browser host is not mounted.');
        }

        const requestId = createRequestId(
          'browser-obs',
          ++requestIdRef.current
        );

        return new Promise<ObservationCollectionResult>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            finalizeObservationRequest(requestId, true);
          }, timeoutMs);

          pendingObservationRequestsRef.current.set(requestId, {
            errors: new Map(),
            expectedFrameIds,
            reject,
            resolve,
            responses: new Map(),
            settleTimeoutId: null,
            startedAt: Date.now(),
            timeoutId,
          });

          hostRef.current
            ?.evaluateJavaScript(
              `(() => {
                if (
                  !window.__MUNINN_OBSERVATION__ ||
                  typeof window.__MUNINN_OBSERVATION__.requestAxSnapshot !== 'function'
                ) {
                  throw new Error('Observation runtime unavailable.');
                }

                return window.__MUNINN_OBSERVATION__.requestAxSnapshot(${JSON.stringify(
                  requestId
                )});
              })()`
            )
            .then((result: BrowserHostEvaluationOutcome) => {
              if (!result.ok) {
                const pendingRequest =
                  pendingObservationRequestsRef.current.get(requestId);

                if (pendingRequest) {
                  clearTimeout(pendingRequest.timeoutId);
                  if (pendingRequest.settleTimeoutId) {
                    clearTimeout(pendingRequest.settleTimeoutId);
                  }
                }

                pendingObservationRequestsRef.current.delete(requestId);
                reject(new Error(result.message));
                return;
              }

              if (
                result.value &&
                typeof result.value === 'object' &&
                'frameId' in result.value &&
                typeof result.value.frameId === 'string'
              ) {
                const pendingRequest =
                  pendingObservationRequestsRef.current.get(requestId);

                if (pendingRequest) {
                  pendingRequest.expectedFrameIds.add(result.value.frameId);
                }
              }

              maybeSettleObservationRequest(requestId);
            })
            .catch((error: unknown) => {
              const pendingRequest =
                pendingObservationRequestsRef.current.get(requestId);

              if (pendingRequest) {
                clearTimeout(pendingRequest.timeoutId);
                if (pendingRequest.settleTimeoutId) {
                  clearTimeout(pendingRequest.settleTimeoutId);
                }
              }

              pendingObservationRequestsRef.current.delete(requestId);
              reject(
                error instanceof Error
                  ? error
                  : new Error('Observation snapshot request failed.')
              );
            });
        });
      },
      [finalizeObservationRequest, maybeSettleObservationRequest]
    );

    useImperativeHandle(
      ref,
      () => ({
        captureViewport,
        evaluateJavaScript: async <T = unknown>(
          source: string,
          options?: {
            timeoutMs?: number;
          }
        ) => {
          const requestId = createRequestId(
            'browser-eval',
            ++requestIdRef.current
          );
          const timeoutMs = options?.timeoutMs ?? 4000;
          const startedAt = Date.now();

          if (!hostRef.current) {
            return {
              ok: false,
              requestId,
              type: 'native_unavailable',
              message: 'The native browser host is not mounted.',
              elapsedMs: 0,
            };
          }

          return new Promise<BrowserEvaluationResult<T>>((resolve) => {
            const timeoutId = setTimeout(() => {
              pendingEvaluationsRef.current.delete(requestId);
              resolve({
                ok: false,
                requestId,
                type: 'timeout',
                message: `Timed out waiting for JavaScript evaluation after ${timeoutMs}ms.`,
                frame: mainTelemetryFrameRef.current ?? undefined,
                elapsedMs: Date.now() - startedAt,
              });
            }, timeoutMs);

            pendingEvaluationsRef.current.set(requestId, {
              resolve: resolve as (result: BrowserEvaluationResult) => void,
              startedAt,
              timeoutId,
            });

            hostRef.current
              ?.evaluateJavaScript(source)
              .then((result: BrowserHostEvaluationOutcome) => {
                if (result.ok) {
                  resolvePendingEvaluation(requestId, {
                    ok: true,
                    requestId,
                    value: result.value as T,
                    elapsedMs: Date.now() - startedAt,
                  });
                  return;
                }

                resolvePendingEvaluation(requestId, {
                  ok: false,
                  requestId,
                  type: result.code,
                  message: result.message,
                  details: result.details,
                  elapsedMs: Date.now() - startedAt,
                });
              })
              .catch((error: unknown) => {
                resolvePendingEvaluation(requestId, {
                  ok: false,
                  requestId,
                  type: 'execution_error',
                  message:
                    error instanceof Error
                      ? error.message
                      : 'Native JavaScript evaluation failed.',
                  details: error,
                  elapsedMs: Date.now() - startedAt,
                });
              });
          });
        },
        observe: async (options) => {
          const quiescence = await waitForQuiescence(options);

          if (!quiescence.satisfied) {
            throw new Error('Timed out waiting for page quiescence.');
          }

          const screenshot = await captureViewport();
          const snapshotResult = await requestObservationSnapshots(
            options?.snapshotTimeoutMs ?? 1600
          );
          const stitched = stitchObservationArtifacts({
            errors: snapshotResult.errors,
            expectedFrameIds: snapshotResult.expectedFrameIds,
            frameLinks: new Map(frameLinksRef.current),
            responses: snapshotResult.responses,
            timedOut: snapshotResult.timedOut,
          });

          if (snapshotResult.timedOut) {
            stitched.warnings.unshift(
              'Timed out waiting for one or more frame snapshot responses.'
            );
          }

          return {
            axSnapshot: stitched.axSnapshot,
            frameSnapshots: stitched.frameSnapshots,
            observedAt: new Date().toISOString(),
            quiescence,
            screenshot,
            warnings: stitched.warnings,
          } satisfies ObservationResult;
        },
        goBack: () => {
          hostRef.current?.goBack().catch(() => undefined);
        },
        goForward: () => {
          hostRef.current?.goForward().catch(() => undefined);
        },
        reload: () => {
          hostRef.current?.reload().catch(() => undefined);
        },
        stopLoading: () => {
          hostRef.current?.stopLoading().catch(() => undefined);
        },
      }),
      [
        captureViewport,
        requestObservationSnapshots,
        resolvePendingEvaluation,
        waitForQuiescence,
      ]
    );

    useEffect(() => {
      return () => {
        failPendingEvaluations(
          'navigation_changed',
          'Browser host unmounted before evaluation completed.'
        );
        failPendingObservationRequests(
          'Browser host unmounted before observation completed.'
        );
      };
    }, [failPendingEvaluations, failPendingObservationRequests]);

    return (
      <View style={styles.container}>
        <BrowserHostView
          afterContentScript={BRIDGE_AFTER_CONTENT_SCRIPT}
          bootstrapScript={BRIDGE_BOOTSTRAP_SCRIPT}
          onLoadProgress={(event) => {
            onProgressChange?.(event.nativeEvent.progress);
          }}
          onLoadStart={handleLoadStart}
          onNavigationError={(event) => {
            onNavigationError?.(event.nativeEvent);
          }}
          onNavigationStateChange={(event) => {
            navigationStateRef.current = event.nativeEvent;
            onNavigationStateChange?.(event.nativeEvent);
          }}
          onTelemetryMessage={(event) => {
            handleTelemetryMessage(event.nativeEvent.data);
          }}
          ref={hostRef}
          sourceBaseUrl={'baseUrl' in source ? source.baseUrl ?? null : null}
          sourceHtml={'html' in source ? source.html : null}
          sourceUrl={'uri' in source ? source.uri : null}
          style={styles.host}
        />
      </View>
    );
  }
);

function createRequestId(prefix: string, seed: number) {
  return `${prefix}-${Date.now().toString(36)}-${seed.toString(36)}`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  host: {
    flex: 1,
  },
});
