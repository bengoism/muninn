import { useEffect, useState } from 'react';
import {
  Platform,
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
      {isLoading && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressBar, { width: progressWidth }]} />
        </View>
      )}
      <View style={styles.row}>
        <Pressable
          disabled={!canGoBack}
          onPress={onGoBack}
          style={[styles.iconButton, !canGoBack && styles.iconButtonDisabled]}
        >
          <Text style={styles.iconText}>{'\u2039'}</Text>
        </Pressable>

        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onBlur={() => setIsEditing(false)}
          onChangeText={(text) => { setIsEditing(true); setDraftUrl(text); }}
          onFocus={() => setIsEditing(true)}
          onSubmitEditing={handleSubmit}
          placeholder="Enter URL"
          placeholderTextColor="#506680"
          returnKeyType="go"
          selectTextOnFocus
          style={styles.urlInput}
          value={draftUrl}
        />

        <Pressable onPress={handleSubmit} style={styles.goButton}>
          <Text style={styles.goButtonText}>Go</Text>
        </Pressable>

        <Pressable onPress={onReload} style={styles.iconButton}>
          <Text style={styles.iconText}>{'\u21BB'}</Text>
        </Pressable>

        <Pressable onPress={onToggleDiagnostics} style={styles.dotButton}>
          <View style={[styles.dot, modelName && styles.dotReady]} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0d1728',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#17263b',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    backgroundColor: '#10203a',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#38bdf8',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconButton: {
    width: 34,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
  },
  iconButtonDisabled: {
    opacity: 0.3,
  },
  iconText: {
    color: '#8ca0bd',
    fontSize: 22,
    fontWeight: '300',
  },
  urlInput: {
    flex: 1,
    backgroundColor: '#101927',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#1f344d',
    color: '#f8fafc',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 12,
    height: 34,
    paddingHorizontal: 10,
  },
  goButton: {
    backgroundColor: '#38bdf8',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  goButtonText: {
    color: '#0b1117',
    fontSize: 13,
    fontWeight: '700',
  },
  dotButton: {
    width: 34,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#64748b',
  },
  dotReady: {
    backgroundColor: '#38bdf8',
  },
});
