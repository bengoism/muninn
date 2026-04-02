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
  bridgeReady: boolean;
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
  bridgeReady,
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
      <View style={styles.metaRow}>
        <View style={styles.titleBlock}>
          <Text numberOfLines={1} style={styles.title}>
            {title || 'Untitled page'}
          </Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {subtitle}
          </Text>
        </View>

        <View style={[styles.bridgePill, bridgeReady ? styles.bridgeReady : null]}>
          <Text style={styles.bridgePillText}>
            {bridgeReady ? 'Bridge ready' : 'Bridge pending'}
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
    backgroundColor: '#111827',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1f2937',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    gap: 12,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  titleBlock: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: '#f8fafc',
    fontSize: 21,
    fontWeight: '800',
  },
  subtitle: {
    color: '#94a3b8',
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    fontSize: 12,
  },
  bridgePill: {
    backgroundColor: '#0f172a',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bridgeReady: {
    backgroundColor: '#082f49',
  },
  bridgePillText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '700',
  },
  addressRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  addressInput: {
    backgroundColor: '#0f172a',
    borderRadius: 14,
    color: '#f8fafc',
    flex: 1,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  submitButton: {
    alignItems: 'center',
    backgroundColor: '#0ea5e9',
    borderRadius: 14,
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
    backgroundColor: '#1e293b',
    borderRadius: 12,
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
  progressTrack: {
    backgroundColor: '#0f172a',
    borderRadius: 999,
    height: 4,
    overflow: 'hidden',
  },
  progressBar: {
    backgroundColor: '#38bdf8',
    borderRadius: 999,
    height: '100%',
  },
});
