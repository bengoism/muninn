import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { StyleSheet, View } from 'react-native';

import {
  BrowserHostView,
  type BrowserHostEvaluationOutcome,
  type BrowserHostViewHandle as NativeBrowserHostViewHandle,
} from '../../../native/browser-host';
import {
  buildBridgeAfterContentScript,
  buildBridgeBootstrapScript,
} from '../bridge/bootstrap';
import { parseBrowserBridgeMessage } from '../bridge/protocol';
import type {
  BrowserBridgeMessage,
  BrowserBridgeParseError,
  BrowserEvaluationFailure,
  BrowserEvaluationResult,
  BrowserFrameMetadata,
  BrowserNavigationError,
  BrowserNavigationStateSnapshot,
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
  evaluateJavaScript: <T = unknown>(
    source: string,
    options?: {
      timeoutMs?: number;
    }
  ) => Promise<BrowserEvaluationResult<T>>;
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
    const pendingEvaluationsRef = useRef<Map<string, PendingEvaluation>>(new Map());
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

    const handleLoadStart = useCallback(() => {
      mainTelemetryFrameRef.current = null;
      failPendingEvaluations(
        'navigation_changed',
        'Page navigation interrupted pending evaluation.'
      );
      onLoadStart?.();
    }, [failPendingEvaluations, onLoadStart]);

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

        onTelemetryMessage?.(parsedMessage);
      },
      [onTelemetryMessage, onTelemetryProtocolError]
    );

    useImperativeHandle(
      ref,
      () => ({
        evaluateJavaScript: async <T = unknown>(
          source: string,
          options?: {
            timeoutMs?: number;
          }
        ) => {
          const requestId = createRequestId(++requestIdRef.current);
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
      [resolvePendingEvaluation]
    );

    useEffect(() => {
      return () => {
        failPendingEvaluations(
          'navigation_changed',
          'Browser host unmounted before evaluation completed.'
        );
      };
    }, [failPendingEvaluations]);

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

function createRequestId(seed: number) {
  return `browser-eval-${Date.now().toString(36)}-${seed.toString(36)}`;
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
