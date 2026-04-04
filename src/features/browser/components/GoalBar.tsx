import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAgentSessionStore } from '../../../state/agent-session-store';

type GoalBarProps = {
  onStart: (goal: string) => void;
  onCancel: () => void;
  isRunning: boolean;
  modelReady: boolean;
};

export function GoalBar({
  onStart,
  onCancel,
  isRunning,
  modelReady,
}: GoalBarProps) {
  const goal = useAgentSessionStore((s) => s.goal);
  const setGoal = useAgentSessionStore((s) => s.setGoal);
  const loopState = useAgentSessionStore((s) => s.loopState);

  const isTerminal =
    loopState === 'finished' ||
    loopState === 'yielded' ||
    loopState === 'failed';

  return (
    <View style={styles.container}>
      <View style={styles.inputRow}>
        <TextInput
          editable={!isRunning}
          onChangeText={setGoal}
          onSubmitEditing={() => {
            if (goal.trim() && modelReady && !isRunning) {
              onStart(goal.trim());
            }
          }}
          placeholder="What should the agent do?"
          placeholderTextColor="#506680"
          returnKeyType="go"
          style={[styles.input, isRunning && styles.inputRunning]}
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
            style={styles.goButton}
          >
            <Text style={styles.goButtonText}>New</Text>
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
            <Text
              style={[
                styles.goButtonText,
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

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0d1728',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1f344d',
    paddingBottom: 4,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 6,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#101927',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1f344d',
    color: '#f8fafc',
    fontSize: 14,
    height: 38,
    paddingHorizontal: 16,
  },
  inputRunning: {
    borderColor: '#38bdf8',
    opacity: 0.7,
  },
  goButton: {
    backgroundColor: '#38bdf8',
    borderRadius: 19,
    height: 38,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  goButtonText: {
    color: '#0b1117',
    fontSize: 14,
    fontWeight: '700',
  },
  stopButton: {
    backgroundColor: '#7f1d1d',
    borderRadius: 19,
    height: 38,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  stopButtonText: {
    color: '#fca5a5',
    fontSize: 14,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonTextDisabled: {
    opacity: 0.6,
  },
});
