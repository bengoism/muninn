import { useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { BRIDGE_FIXTURE_URL } from '../fixtures/bridge-fixture';
import { normalizeBrowserUrl } from '../utils/url';

type BrowserChromeProps = {
  telemetryReady: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  currentUrl: string;
  isLoading: boolean;
  progress: number;
  requestedUrl: string;
  title: string;
  onGoBack: () => void;
  onGoForward: () => void;
  onLoadFixture: () => void;
  onReload: () => void;
  onSubmitUrl: (url: string) => void;
};

export function BrowserChrome({
  telemetryReady,
  canGoBack,
  canGoForward,
  currentUrl,
  isLoading,
  progress,
  requestedUrl,
  title,
  onGoBack,
  onGoForward,
  onLoadFixture,
  onReload,
  onSubmitUrl,
}: BrowserChromeProps) {
  const [draftUrl, setDraftUrl] = useState(requestedUrl);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (isEditing) {
      return;
    }

    setDraftUrl(requestedUrl !== currentUrl ? requestedUrl : currentUrl || requestedUrl);
  }, [currentUrl, isEditing, requestedUrl]);

  const handleSubmit = () => {
    setIsEditing(false);
    onSubmitUrl(normalizeBrowserUrl(draftUrl));
  };

  const progressWidth = `${Math.max(progress, isLoading ? 0.08 : 0) * 100}%` as const;
  const subtitle =
    requestedUrl === BRIDGE_FIXTURE_URL
      ? 'Local bridge fixture'
      : requestedUrl !== currentUrl
        ? requestedUrl
        : currentUrl;

  return (
    <View style={styles.container}>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressBar,
            {
              width: progressWidth,
              opacity: isLoading || progress < 1 ? 1 : 0,
            },
          ]}
        />
      </View>

      <View style={styles.metaRow}>
        <View style={styles.titleBlock}>
          <Text numberOfLines={2} style={styles.title}>
            {title || 'Untitled page'}
          </Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {subtitle}
          </Text>
        </View>

        <View
          style={[
            styles.bridgePill,
            telemetryReady ? styles.bridgeReady : null,
          ]}
        >
          <View
            style={[
              styles.bridgePillDot,
              telemetryReady ? styles.bridgePillDotReady : null,
            ]}
          />
          <Text style={styles.bridgePillText}>
            {telemetryReady ? 'Telemetry active' : 'Telemetry pending'}
          </Text>
        </View>
      </View>

      <View style={styles.addressRow}>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onBlur={() => setIsEditing(false)}
          onChangeText={setDraftUrl}
          onFocus={() => setIsEditing(true)}
          onSubmitEditing={handleSubmit}
          placeholder="Enter a URL"
          placeholderTextColor="#64748b"
          returnKeyType="go"
          style={styles.addressInput}
          value={draftUrl}
        />
        <Pressable onPress={handleSubmit} style={styles.submitButton}>
          <Text style={styles.submitButtonText}>Go</Text>
        </Pressable>
      </View>

      <View style={styles.controlRow}>
        <BrowserChromeButton
          disabled={!canGoBack}
          label="Back"
          onPress={onGoBack}
        />
        <BrowserChromeButton
          disabled={!canGoForward}
          label="Forward"
          onPress={onGoForward}
        />
        <BrowserChromeButton label="Reload" onPress={onReload} />
        <BrowserChromeButton label="Fixture" onPress={onLoadFixture} />
      </View>
    </View>
  );
}

type BrowserChromeButtonProps = {
  disabled?: boolean;
  label: string;
  onPress: () => void;
};

function BrowserChromeButton({
  disabled = false,
  label,
  onPress,
}: BrowserChromeButtonProps) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.controlButton,
        disabled ? styles.controlButtonDisabled : null,
        pressed && !disabled ? styles.controlButtonPressed : null,
      ]}
    >
      <Text style={styles.controlButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0d1728',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#17263b',
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 14,
  },
  progressTrack: {
    backgroundColor: '#10203a',
    borderRadius: 999,
    height: 4,
    overflow: 'hidden',
  },
  metaRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  titleBlock: {
    flex: 1,
    gap: 6,
  },
  title: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 24,
  },
  subtitle: {
    color: '#8ca0bd',
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    fontSize: 11.5,
  },
  bridgePill: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#10213a',
    borderColor: '#1e3653',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 34,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bridgePillDot: {
    backgroundColor: '#64748b',
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  bridgeReady: {
    backgroundColor: '#0d3050',
    borderColor: '#1f5f8b',
  },
  bridgePillDotReady: {
    backgroundColor: '#38bdf8',
  },
  bridgePillText: {
    color: '#dbeafe',
    fontSize: 12,
    fontWeight: '700',
  },
  addressRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  addressInput: {
    backgroundColor: '#0f1b2e',
    borderColor: '#1e3653',
    borderRadius: 16,
    borderWidth: 1,
    color: '#f8fafc',
    flex: 1,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  submitButton: {
    alignItems: 'center',
    backgroundColor: '#38bdf8',
    borderRadius: 16,
    justifyContent: 'center',
    minWidth: 64,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  submitButtonText: {
    color: '#082f49',
    fontSize: 14,
    fontWeight: '800',
  },
  controlRow: {
    flexDirection: 'row',
    gap: 10,
  },
  controlButton: {
    alignItems: 'center',
    backgroundColor: '#162235',
    borderColor: '#22354f',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 10,
  },
  controlButtonPressed: {
    opacity: 0.88,
  },
  controlButtonDisabled: {
    opacity: 0.4,
  },
  controlButtonText: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700',
  },
  progressBar: {
    backgroundColor: '#38bdf8',
    borderRadius: 999,
    height: '100%',
  },
});
