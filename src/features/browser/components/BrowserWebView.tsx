import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';
import type {
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  WebViewMessageEvent,
  WebViewNavigation,
  WebViewNavigationEvent,
  WebViewNativeEvent,
  WebViewProgressEvent,
} from 'react-native-webview/lib/WebViewTypes';

import {
  buildBridgeAfterContentScript,
  buildBridgeBootstrapScript,
  buildBridgeEvaluationScript,
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
  onBridgeMessage?: (message: BrowserBridgeMessage) => void;
  onBridgeProtocolError?: (error: BrowserBridgeParseError) => void;
  onLoadStart?: () => void;
  onNavigationError?: (error: BrowserNavigationError) => void;
  onNavigationStateChange?: (
    navigationState: BrowserNavigationStateSnapshot
  ) => void;
  onProgressChange?: (progress: number) => void;
};

export type BrowserWebViewHandle = {
  evaluateJavaScript: <T = unknown>(
    source: string,
    options?: {
      bridgeReadyTimeoutMs?: number;
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

type BridgeReadyWaiter = {
  resolve: (ready: boolean) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

const BRIDGE_BOOTSTRAP_SCRIPT = buildBridgeBootstrapScript();
const BRIDGE_AFTER_CONTENT_SCRIPT = buildBridgeAfterContentScript();

export const BrowserWebView = forwardRef<BrowserWebViewHandle, BrowserWebViewProps>(
  function BrowserWebView(
    {
      requestedUrl,
      onBridgeMessage,
      onBridgeProtocolError,
      onLoadStart,
      onNavigationError,
      onNavigationStateChange,
      onProgressChange,
    },
    ref
  ) {
    const webViewRef = useRef<WebView>(null);
    const bridgeReadyRef = useRef(false);
    const mainFrameRef = useRef<BrowserFrameMetadata | null>(null);
    const pendingEvaluationsRef = useRef<Map<string, PendingEvaluation>>(
      new Map()
    );
    const bridgeWaitersRef = useRef<BridgeReadyWaiter[]>([]);
    const requestIdRef = useRef(0);

    const notifyNavigationState = useCallback(
      (navigationState: WebViewNativeEvent) => {
        onNavigationStateChange?.({
          canGoBack: navigationState.canGoBack,
          canGoForward: navigationState.canGoForward,
          isLoading: navigationState.loading,
          title: navigationState.title,
          url: navigationState.url,
        });
      },
      [onNavigationStateChange]
    );

    const resolveBridgeWaiters = useCallback((ready: boolean) => {
      const waiters = bridgeWaitersRef.current;
      bridgeWaitersRef.current = [];

      waiters.forEach((waiter) => {
        clearTimeout(waiter.timeoutId);
        waiter.resolve(ready);
      });
    }, []);

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

    const waitForBridgeReady = useCallback(
      (timeoutMs: number) => {
        if (bridgeReadyRef.current) {
          return Promise.resolve(true);
        }

        return new Promise<boolean>((resolve) => {
          const timeoutId = setTimeout(() => {
            bridgeWaitersRef.current = bridgeWaitersRef.current.filter(
              (waiter) => waiter.timeoutId !== timeoutId
            );
            resolve(false);
          }, timeoutMs);

          bridgeWaitersRef.current.push({
            resolve,
            timeoutId,
          });
        });
      },
      []
    );

    const handleLoadStart = useCallback(
      (event: WebViewErrorEvent | WebViewNavigationEvent) => {
        bridgeReadyRef.current = false;
        mainFrameRef.current = null;
        resolveBridgeWaiters(false);
        failPendingEvaluations(
          'navigation_changed',
          'Page navigation interrupted pending evaluation.'
        );
        onLoadStart?.();
        notifyNavigationState(event.nativeEvent);
      },
      [failPendingEvaluations, notifyNavigationState, onLoadStart, resolveBridgeWaiters]
    );

    const handleLoadProgress = useCallback(
      (event: WebViewProgressEvent) => {
        onProgressChange?.(event.nativeEvent.progress);
      },
      [onProgressChange]
    );

    const handleLoadEnd = useCallback(
      (event: WebViewErrorEvent | WebViewNavigationEvent) => {
        notifyNavigationState(event.nativeEvent);
      },
      [notifyNavigationState]
    );

    const handleNavigationStateChange = useCallback(
      (navigationState: WebViewNavigation) => {
        notifyNavigationState(navigationState);
      },
      [notifyNavigationState]
    );

    const handleNavigationError = useCallback(
      (event: WebViewErrorEvent) => {
        onNavigationError?.({
          type: 'navigation_error',
          code: event.nativeEvent.code,
          description: event.nativeEvent.description,
          url: event.nativeEvent.url,
        });
      },
      [onNavigationError]
    );

    const handleHttpError = useCallback(
      (event: WebViewHttpErrorEvent) => {
        onNavigationError?.({
          type: 'http_error',
          description: event.nativeEvent.description,
          statusCode: event.nativeEvent.statusCode,
          url: event.nativeEvent.url,
        });
      },
      [onNavigationError]
    );

    const handleBridgeMessage = useCallback(
      (event: WebViewMessageEvent) => {
        const parsedMessage = parseBrowserBridgeMessage(event.nativeEvent.data);

        if (!parsedMessage) {
          return;
        }

        if ('type' in parsedMessage) {
          onBridgeProtocolError?.(parsedMessage);
          return;
        }

        if (
          parsedMessage.kind === 'bridge_ready' &&
          parsedMessage.frame.isTopFrame
        ) {
          bridgeReadyRef.current = true;
          mainFrameRef.current = parsedMessage.frame;
          resolveBridgeWaiters(true);
        }

        if (parsedMessage.kind === 'eval_result') {
          const pending = pendingEvaluationsRef.current.get(parsedMessage.payload.requestId);

          if (pending) {
            resolvePendingEvaluation(parsedMessage.payload.requestId, {
              ok: true,
              requestId: parsedMessage.payload.requestId,
              value: parsedMessage.payload.value,
              frame: parsedMessage.frame,
              elapsedMs: Date.now() - pending.startedAt,
            });
          }
        }

        if (parsedMessage.kind === 'eval_error') {
          const pending = pendingEvaluationsRef.current.get(parsedMessage.payload.requestId);

          if (pending) {
            resolvePendingEvaluation(parsedMessage.payload.requestId, {
              ok: false,
              requestId: parsedMessage.payload.requestId,
              type: parsedMessage.payload.code,
              message: parsedMessage.payload.message,
              details: parsedMessage.payload.details,
              frame: parsedMessage.frame,
              elapsedMs: Date.now() - pending.startedAt,
            });
          }
        }

        onBridgeMessage?.(parsedMessage);
      },
      [onBridgeMessage, onBridgeProtocolError, resolveBridgeWaiters, resolvePendingEvaluation]
    );

    useImperativeHandle(
      ref,
      () => ({
        evaluateJavaScript: async <T = unknown>(
          source: string,
          options?: {
            bridgeReadyTimeoutMs?: number;
            timeoutMs?: number;
          }
        ) => {
          const requestId = createRequestId(++requestIdRef.current);
          const bridgeReadyTimeoutMs = options?.bridgeReadyTimeoutMs ?? 2500;
          const timeoutMs = options?.timeoutMs ?? 4000;
          const startedAt = Date.now();

          if (!webViewRef.current) {
            return {
              ok: false,
              requestId,
              type: 'bridge_unavailable',
              message: 'The browser host is not mounted.',
              elapsedMs: 0,
            };
          }

          const bridgeReady = await waitForBridgeReady(bridgeReadyTimeoutMs);

          if (!bridgeReady) {
            return {
              ok: false,
              requestId,
              type: 'bridge_unavailable',
              message: 'Timed out waiting for the browser bridge to become ready.',
              elapsedMs: Date.now() - startedAt,
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
                frame: mainFrameRef.current ?? undefined,
                elapsedMs: Date.now() - startedAt,
              });
            }, timeoutMs);

            pendingEvaluationsRef.current.set(requestId, {
              resolve: resolve as (result: BrowserEvaluationResult) => void,
              startedAt,
              timeoutId,
            });

            webViewRef.current?.injectJavaScript(
              buildBridgeEvaluationScript(requestId, source)
            );
          });
        },
        goBack: () => webViewRef.current?.goBack(),
        goForward: () => webViewRef.current?.goForward(),
        reload: () => webViewRef.current?.reload(),
        stopLoading: () => webViewRef.current?.stopLoading(),
      }),
      [waitForBridgeReady]
    );

    useEffect(() => {
      return () => {
        resolveBridgeWaiters(false);
        failPendingEvaluations(
          'navigation_changed',
          'Browser host unmounted before evaluation completed.'
        );
      };
    }, [failPendingEvaluations, resolveBridgeWaiters]);

    return (
      <View style={styles.container}>
        <WebView
          allowsBackForwardNavigationGestures
          injectedJavaScript={BRIDGE_AFTER_CONTENT_SCRIPT}
          injectedJavaScriptBeforeContentLoaded={BRIDGE_BOOTSTRAP_SCRIPT}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly={
            Platform.OS !== 'ios'
          }
          injectedJavaScriptForMainFrameOnly={Platform.OS !== 'ios'}
          javaScriptEnabled
          originWhitelist={['http://*', 'https://*', 'about:*']}
          onError={handleNavigationError}
          onHttpError={handleHttpError}
          onLoadEnd={handleLoadEnd}
          onLoadProgress={handleLoadProgress}
          onLoadStart={handleLoadStart}
          onMessage={handleBridgeMessage}
          onNavigationStateChange={handleNavigationStateChange}
          ref={webViewRef}
          source={resolveBrowserSource(requestedUrl)}
          style={styles.webView}
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
  webView: {
    flex: 1,
  },
});
