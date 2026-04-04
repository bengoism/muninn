import { useEffect, useState } from 'react';
import {
  Modal,
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
  onGoForward,
  onLoadFixture,
  onReload,
  onSubmitUrl,
  onToggleDiagnostics,
  canGoForward,
}: BrowserChromeProps) {
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [draftUrl, setDraftUrl] = useState(currentUrl || requestedUrl);

  useEffect(() => {
    if (!showUrlModal) {
      setDraftUrl(currentUrl || requestedUrl);
    }
  }, [currentUrl, requestedUrl, showUrlModal]);

  const displayUrl = currentUrl || requestedUrl;
  const displayHost = (() => {
    try {
      return new URL(displayUrl).hostname.replace(/^www\./, '');
    } catch {
      return displayUrl;
    }
  })();

  const progressWidth = `${Math.max(progress, isLoading ? 0.08 : 0) * 100}%` as const;

  return (
    <>
      <View style={styles.container}>
        <View style={styles.row}>
          <Pressable
            disabled={!canGoBack}
            onPress={onGoBack}
            style={[styles.backButton, !canGoBack && styles.backButtonDisabled]}
          >
            <Text style={styles.backText}>{'\u2039'}</Text>
          </Pressable>

          <Pressable
            onPress={() => setShowUrlModal(true)}
            style={styles.urlPill}
          >
            {isLoading && (
              <View style={styles.progressTrack}>
                <View style={[styles.progressBar, { width: progressWidth }]} />
              </View>
            )}
            <Text numberOfLines={1} style={styles.urlText}>
              {displayHost}
            </Text>
          </Pressable>

          <Pressable onPress={onToggleDiagnostics} style={styles.modelDot}>
            <View
              style={[
                styles.dot,
                modelName ? styles.dotReady : null,
              ]}
            />
          </Pressable>
        </View>
      </View>

      <Modal
        visible={showUrlModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowUrlModal(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowUrlModal(false)}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalUrlRow}>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                onChangeText={setDraftUrl}
                onSubmitEditing={() => {
                  setShowUrlModal(false);
                  onSubmitUrl(normalizeBrowserUrl(draftUrl));
                }}
                placeholder="Enter URL"
                placeholderTextColor="#64748b"
                returnKeyType="go"
                selectTextOnFocus
                style={styles.modalUrlInput}
                value={draftUrl}
              />
            </View>
            <View style={styles.modalControls}>
              <Pressable
                disabled={!canGoBack}
                onPress={() => { setShowUrlModal(false); onGoBack(); }}
                style={[styles.modalButton, !canGoBack && styles.modalButtonDisabled]}
              >
                <Text style={styles.modalButtonText}>Back</Text>
              </Pressable>
              <Pressable
                disabled={!canGoForward}
                onPress={() => { setShowUrlModal(false); onGoForward(); }}
                style={[styles.modalButton, !canGoForward && styles.modalButtonDisabled]}
              >
                <Text style={styles.modalButtonText}>Forward</Text>
              </Pressable>
              <Pressable
                onPress={() => { setShowUrlModal(false); onReload(); }}
                style={styles.modalButton}
              >
                <Text style={styles.modalButtonText}>Reload</Text>
              </Pressable>
              <Pressable
                onPress={() => { setShowUrlModal(false); onLoadFixture(); }}
                style={styles.modalButton}
              >
                <Text style={styles.modalButtonText}>Fixture</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0d1728',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#17263b',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonDisabled: {
    opacity: 0.3,
  },
  backText: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '300',
    marginTop: -2,
  },
  urlPill: {
    flex: 1,
    backgroundColor: '#101927',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  urlText: {
    color: '#8ca0bd',
    fontSize: 13,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    textAlign: 'center',
  },
  progressTrack: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    right: 0,
    height: 2,
    backgroundColor: '#10203a',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#38bdf8',
    borderRadius: 1,
  },
  modelDot: {
    width: 32,
    height: 32,
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
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-start',
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  modalContent: {
    backgroundColor: '#0d1728',
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  modalUrlRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modalUrlInput: {
    flex: 1,
    backgroundColor: '#101927',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1f344d',
    color: '#f8fafc',
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  modalControls: {
    flexDirection: 'row',
    gap: 8,
  },
  modalButton: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#162235',
    borderRadius: 12,
    paddingVertical: 10,
  },
  modalButtonDisabled: {
    opacity: 0.4,
  },
  modalButtonText: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '600',
  },
});
