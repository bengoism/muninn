import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChatPanel } from './ChatPanel';

type Tab = 'chat' | 'debug';

type BottomPanelProps = {
  expanded: boolean;
  onToggle: () => void;
};

export function BottomPanel({ expanded, onToggle }: BottomPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('chat');

  return (
    <View style={[styles.container, expanded && styles.containerExpanded]}>
      <View style={styles.tabBar}>
        <Pressable style={styles.handle} onPress={onToggle}>
          <View style={styles.handleIndicator} />
        </Pressable>
        <View style={styles.tabs}>
          <Pressable
            onPress={() => { setActiveTab('chat'); if (!expanded) onToggle(); }}
            style={[styles.tab, activeTab === 'chat' && styles.tabActive]}
          >
            <Text style={[styles.tabText, activeTab === 'chat' && styles.tabTextActive]}>
              Chat
            </Text>
          </Pressable>
          <Pressable
            onPress={() => { setActiveTab('debug'); if (!expanded) onToggle(); }}
            style={[styles.tab, activeTab === 'debug' && styles.tabActive]}
          >
            <Text style={[styles.tabText, activeTab === 'debug' && styles.tabTextActive]}>
              Debug
            </Text>
          </Pressable>
        </View>
      </View>

      {expanded && (
        <View style={styles.content}>
          {activeTab === 'chat' ? (
            <ChatPanel />
          ) : (
            <View style={styles.debugPlaceholder}>
              <Text style={styles.debugText}>Debug telemetry coming soon</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0d1728',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1f344d',
  },
  containerExpanded: {
    flex: 1,
    maxHeight: '65%',
  },
  tabBar: {
    alignItems: 'center',
  },
  handle: {
    paddingVertical: 6,
    paddingHorizontal: 40,
  },
  handleIndicator: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#2a3f5c',
  },
  tabs: {
    flexDirection: 'row',
    gap: 2,
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 14,
  },
  tabActive: {
    backgroundColor: '#172540',
  },
  tabText: {
    color: '#506680',
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#7dd3fc',
  },
  content: {
    flex: 1,
  },
  debugPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  debugText: {
    color: '#506680',
    fontSize: 13,
  },
});
