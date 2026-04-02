import { useState } from 'react';
import {
  ActivityIndicator,
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
import { WebView } from 'react-native-webview';

import { DEFAULT_BROWSER_URL } from '../../../config/runtime';
import { runInference } from '../../../native/agent-runtime';
import { useAgentSessionStore } from '../../../state/agent-session-store';
import { useBrowserStore } from '../../../state/browser-store';
import type { InferenceResponse } from '../../../types/agent';

export function BrowserScreen() {
  const currentUrl = useBrowserStore((state) => state.currentUrl);
  const isLoading = useBrowserStore((state) => state.isLoading);
  const setCurrentUrl = useBrowserStore((state) => state.setCurrentUrl);
  const setIsLoading = useBrowserStore((state) => state.setIsLoading);

  const goal = useAgentSessionStore((state) => state.goal);
  const loopState = useAgentSessionStore((state) => state.loopState);
  const lastNativeResponse = useAgentSessionStore(
    (state) => state.lastNativeResponse
  );
  const lastError = useAgentSessionStore((state) => state.lastError);
  const setGoal = useAgentSessionStore((state) => state.setGoal);
  const setLoopState = useAgentSessionStore((state) => state.setLoopState);
  const setLastNativeResponse = useAgentSessionStore(
    (state) => state.setLastNativeResponse
  );
  const setLastError = useAgentSessionStore((state) => state.setLastError);

  const [isRunningSmokeTest, setIsRunningSmokeTest] = useState(false);

  const handleNativeSmokeTest = async () => {
    try {
      setIsRunningSmokeTest(true);
      setLoopState('reasoning');
      setLastError(null);

      const response = await runInference({
        goal,
        screenshotUri: 'file:///bootstrap-smoke-screenshot.png',
        axSnapshot: [],
        actionHistory: [],
      });

      setLastNativeResponse(response);
      setLoopState(mapResponseToLoopState(response));
    } catch (error) {
      setLoopState('failed');
      setLastNativeResponse(null);
      setLastError(
        error instanceof Error ? error.message : 'Native smoke test failed.'
      );
    } finally {
      setIsRunningSmokeTest(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <SafeAreaView edges={['top']} style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>Issue #1 Bootstrap</Text>
            <Text style={styles.title}>Muninn Browser Host</Text>
          </View>
          <View style={styles.statusPill}>
            {isLoading ? <ActivityIndicator color="#7dd3fc" size="small" /> : null}
            <Text style={styles.statusText}>{isLoading ? 'Loading' : 'Idle'}</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.panelContent}
          keyboardShouldPersistTaps="handled"
          style={styles.panel}
        >
          <Text style={styles.sectionLabel}>Current URL</Text>
          <Text style={styles.monospaceText} numberOfLines={2}>
            {currentUrl}
          </Text>

          <Text style={styles.sectionLabel}>Goal Placeholder</Text>
          <TextInput
            multiline
            onChangeText={setGoal}
            placeholder="Describe the browser task to run later."
            placeholderTextColor="#64748b"
            style={styles.goalInput}
            value={goal}
          />

          <Text style={styles.sectionLabel}>Native Bridge Smoke Test</Text>
          <Pressable
            disabled={isRunningSmokeTest}
            onPress={handleNativeSmokeTest}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed ? styles.primaryButtonPressed : null,
              isRunningSmokeTest ? styles.primaryButtonDisabled : null,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {isRunningSmokeTest ? 'Running...' : 'Run native inference stub'}
            </Text>
          </Pressable>

          <View style={styles.responseCard}>
            <Text style={styles.responseLabel}>Loop state</Text>
            <Text style={styles.responseValue}>{loopState}</Text>

            <Text style={styles.responseLabel}>Last response</Text>
            <Text style={styles.responseValue}>
              {formatResponse(lastNativeResponse)}
            </Text>

            <Text style={styles.responseLabel}>Last error</Text>
            <Text style={styles.responseValue}>{lastError ?? 'None'}</Text>
          </View>
        </ScrollView>

        <View style={styles.webviewFrame}>
          <WebView
            onLoadEnd={() => setIsLoading(false)}
            onLoadStart={() => setIsLoading(true)}
            onNavigationStateChange={(state) => setCurrentUrl(state.url)}
            source={{ uri: DEFAULT_BROWSER_URL }}
            style={styles.webview}
          />
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function mapResponseToLoopState(response: InferenceResponse) {
  if (response.action === 'yield_to_user') {
    return 'yielded' as const;
  }

  if (response.action === 'finish') {
    return 'finished' as const;
  }

  return 'acting' as const;
}

function formatResponse(response: InferenceResponse | null) {
  if (!response) {
    return 'No native response yet.';
  }

  return JSON.stringify(response, null, 2);
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    backgroundColor: '#111827',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1f2937',
  },
  eyebrow: {
    color: '#7dd3fc',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  title: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '700',
    marginTop: 4,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  statusText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
  },
  panel: {
    maxHeight: 320,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1f2937',
  },
  panelContent: {
    padding: 20,
    gap: 12,
  },
  sectionLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  monospaceText: {
    color: '#e2e8f0',
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    fontSize: 13,
    backgroundColor: '#111827',
    borderRadius: 10,
    padding: 12,
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
  primaryButton: {
    backgroundColor: '#0ea5e9',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonPressed: {
    opacity: 0.85,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#082f49',
    fontSize: 15,
    fontWeight: '800',
  },
  responseCard: {
    gap: 8,
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 14,
  },
  responseLabel: {
    color: '#7dd3fc',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  responseValue: {
    color: '#e2e8f0',
    fontSize: 13,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
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
  webview: {
    flex: 1,
  },
});
