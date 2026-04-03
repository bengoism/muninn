import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAgentSessionStore } from '../../../state/agent-session-store';
import type { LoopState } from '../../../types/agent';

type GoalBarProps = {
  onStart: (goal: string) => void;
  onCancel: () => void;
  isRunning: boolean;
  currentStep: number;
  modelReady: boolean;
  onDownloadModel: () => void;
  isDownloading: boolean;
};

export function GoalBar({
  onStart,
  onCancel,
  isRunning,
  currentStep,
  modelReady,
  onDownloadModel,
  isDownloading,
}: GoalBarProps) {
  const goal = useAgentSessionStore((s) => s.goal);
  const setGoal = useAgentSessionStore((s) => s.setGoal);
  const loopState = useAgentSessionStore((s) => s.loopState);
  const lastError = useAgentSessionStore((s) => s.lastError);
  const lastResponse = useAgentSessionStore((s) => s.lastNativeResponse);

  const isTerminal =
    loopState === 'finished' ||
    loopState === 'yielded' ||
    loopState === 'failed';

  const finishMessage =
    lastResponse?.ok && 'parameters' in lastResponse
      ? (lastResponse.parameters.message as string) ?? null
      : null;

  return (
    <View style={styles.container}>
      {!modelReady && (
        <Pressable
          onPress={isDownloading ? undefined : onDownloadModel}
          style={[styles.banner, isDownloading && styles.bannerDisabled]}
        >
          <Text style={styles.bannerText}>
            {isDownloading
              ? 'Downloading Gemma 4 E2B...'
              : 'Tap to download Gemma 4 E2B (2.4 GB)'}
          </Text>
        </Pressable>
      )}

      {isTerminal && (
        <View style={styles.statusRow}>
          <Text
            style={[
              styles.statusText,
              loopState === 'finished' && styles.statusSuccess,
              loopState === 'failed' && styles.statusError,
              loopState === 'yielded' && styles.statusYielded,
            ]}
            numberOfLines={2}
          >
            {loopState === 'finished' && (finishMessage ?? 'Done')}
            {loopState === 'yielded' && (finishMessage ?? 'Needs your input')}
            {loopState === 'failed' && (lastError ?? 'Something went wrong')}
          </Text>
        </View>
      )}

      {isRunning && (
        <View style={styles.statusRow}>
          <Text style={styles.runningText}>
            Step {currentStep + 1} {formatRunningState(loopState)}
          </Text>
        </View>
      )}

      <View style={styles.inputRow}>
        <TextInput
          editable={!isRunning}
          multiline
          onChangeText={setGoal}
          placeholder="What should the agent do on this page?"
          placeholderTextColor="#506680"
          style={[styles.input, isRunning && styles.inputDisabled]}
          value={goal}
        />
        {isRunning ? (
          <Pressable onPress={onCancel} style={styles.cancelButton}>
            <Text style={styles.cancelButtonText}>Stop</Text>
          </Pressable>
        ) : isTerminal ? (
          <Pressable
            onPress={() => {
              useAgentSessionStore.getState().setLoopState('idle');
              useAgentSessionStore.getState().setLastError(null);
            }}
            style={styles.startButton}
          >
            <Text style={styles.startButtonText}>New</Text>
          </Pressable>
        ) : (
          <Pressable
            disabled={!modelReady || !goal.trim()}
            onPress={() => onStart(goal)}
            style={[
              styles.startButton,
              (!modelReady || !goal.trim()) && styles.buttonDisabled,
            ]}
          >
            <Text
              style={[
                styles.startButtonText,
                (!modelReady || !goal.trim()) && styles.buttonTextDisabled,
              ]}
            >
              Go
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function formatRunningState(loopState: LoopState): string {
  switch (loopState) {
    case 'observing':
      return '- Looking at page...';
    case 'reasoning':
      return '- Thinking...';
    case 'acting':
      return '- Taking action...';
    case 'validating':
      return '- Checking result...';
    default:
      return '';
  }
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0d1728',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1f344d',
    paddingBottom: 4,
  },
  banner: {
    backgroundColor: '#1e3a5f',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  bannerDisabled: {
    opacity: 0.6,
  },
  bannerText: {
    color: '#7dd3fc',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  statusRow: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 2,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
  },
  statusSuccess: {
    color: '#4ade80',
  },
  statusError: {
    color: '#f87171',
  },
  statusYielded: {
    color: '#fbbf24',
  },
  runningText: {
    color: '#7dd3fc',
    fontSize: 13,
    fontWeight: '600',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#101927',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1f344d',
    color: '#f8fafc',
    fontSize: 15,
    maxHeight: 80,
    minHeight: 40,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  startButton: {
    backgroundColor: '#38bdf8',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  startButtonText: {
    color: '#0b1117',
    fontSize: 15,
    fontWeight: '700',
  },
  cancelButton: {
    backgroundColor: '#7f1d1d',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  cancelButtonText: {
    color: '#fca5a5',
    fontSize: 15,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonTextDisabled: {
    opacity: 0.6,
  },
});
