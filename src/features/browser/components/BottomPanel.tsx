import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChatPanel } from './ChatPanel';

type Tab = 'chat' | 'debug';

export function BottomPanel() {
  const sheetRef = useRef<BottomSheet>(null);
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const snapPoints = useMemo(() => [56, '50%', '85%'], []);

  const handleTabPress = useCallback(
    (tab: Tab) => {
      setActiveTab(tab);
      sheetRef.current?.snapToIndex(1);
    },
    [],
  );

  return (
    <BottomSheet
      ref={sheetRef}
      snapPoints={snapPoints}
      index={0}
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.handleIndicator}
      enablePanDownToClose={false}
    >
      <View style={styles.tabBar}>
        <Pressable
          onPress={() => handleTabPress('chat')}
          style={[styles.tab, activeTab === 'chat' && styles.tabActive]}
        >
          <Text style={[styles.tabText, activeTab === 'chat' && styles.tabTextActive]}>
            Chat
          </Text>
        </Pressable>
        <Pressable
          onPress={() => handleTabPress('debug')}
          style={[styles.tab, activeTab === 'debug' && styles.tabActive]}
        >
          <Text style={[styles.tabText, activeTab === 'debug' && styles.tabTextActive]}>
            Debug
          </Text>
        </Pressable>
      </View>

      <BottomSheetView style={styles.content}>
        {activeTab === 'chat' ? (
          <ChatPanel />
        ) : (
          <View style={styles.debugPlaceholder}>
            <Text style={styles.debugText}>Debug telemetry coming soon</Text>
          </View>
        )}
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  background: {
    backgroundColor: '#0d1728',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  handleIndicator: {
    backgroundColor: '#2a3f5c',
    width: 36,
  },
  tabBar: {
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
