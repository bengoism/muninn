import { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { normalizeBrowserUrl } from '../utils/url';

type BrowserChromeProps = {
  telemetryReady: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  currentUrl: string;
  isLoading: boolean;
  modelName: string | null;
  progress: number;
  requestedUrl: string;
  title: string;
  onGoBack: () => void;
  onGoForward: () => void;
  onLoadFixture: () => void;
  onReload: () => void;
  onSubmitUrl: (url: string) => void;
  onToggleDiagnostics: () => void;
};

export function BrowserChrome({
  canGoBack,
  currentUrl,
  isLoading,
  modelName,
  progress,
  requestedUrl,
  onGoBack,
  onReload,
  onSubmitUrl,
  onToggleDiagnostics,
}: BrowserChromeProps) {
  const [draftUrl, setDraftUrl] = useState(currentUrl || requestedUrl);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setDraftUrl(currentUrl || requestedUrl);
    }
  }, [currentUrl, requestedUrl, isEditing]);

  const handleSubmit = () => {
    setIsEditing(false);
    onSubmitUrl(normalizeBrowserUrl(draftUrl));
  };

  const progressWidth = `${Math.max(progress, isLoading ? 0.08 : 0) * 100}%` as const;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Pressable
          disabled={!canGoBack}
          onPress={onGoBack}
          style={[styles.iconButton, !canGoBack && styles.disabled]}
        >
          <Text style={styles.iconText}>{'\u2039'}</Text>
        </Pressable>

        <View style={styles.urlContainer}>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onBlur={() => setIsEditing(false)}
            onChangeText={(text) => { setIsEditing(true); setDraftUrl(text); }}
            onFocus={() => setIsEditing(true)}
            onSubmitEditing={handleSubmit}
            placeholder="Search or enter URL"
            placeholderTextColor="#555"
            returnKeyType="go"
            selectTextOnFocus
            style={styles.urlInput}
            value={draftUrl}
          />
        </View>

        <Pressable onPress={onReload} style={styles.iconButton}>
          <Text style={styles.reloadText}>{'\u21BB'}</Text>
        </Pressable>

        <Pressable onPress={onToggleDiagnostics} style={styles.iconButton}>
          <View style={[styles.dot, modelName && styles.dotReady]} />
        </Pressable>
      </View>

      {isLoading && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressBar, { width: progressWidth }]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.25,
  },
  iconText: {
    color: '#888',
    fontSize: 22,
    fontWeight: '300',
  },
  reloadText: {
    color: '#888',
    fontSize: 18,
  },
  urlContainer: {
    flex: 1,
  },
  urlInput: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#222',
    color: '#ededed',
    fontSize: 14,
    height: 36,
    paddingHorizontal: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#555',
  },
  dotReady: {
    backgroundColor: '#00d47e',
  },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
    backgroundColor: 'transparent',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#ededed',
  },
});
