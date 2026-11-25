/**
 * App Store-inspired inline header for the four main tab pages.
 * Renders directly under the top safe area without pull-to-refresh or Liquid Glass pills.
 */

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useIos18Palette } from '../theme/tokens';

export interface HeaderActionButton {
  id: string;
  symbol: SFSymbol;
  accessibilityLabel: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  tintColor?: string;
}

interface AppStoreTabHeaderProps {
  title: string;
  subtitle?: string;
  actions?: HeaderActionButton[];
}

export function AppStoreTabHeader({ title, subtitle, actions = [] }: AppStoreTabHeaderProps) {
  const insets = useSafeAreaInsets();
  const palette = useIos18Palette();

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top + 8,
        },
      ]}
    >
      <View style={styles.titleRow}>
        <View style={styles.titleBlock}>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: palette.textSecondary }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
          <Text style={[styles.largeTitle, { color: palette.textPrimary }]} numberOfLines={1}>
            {title}
          </Text>
        </View>

        {actions.length > 0 ? (
          <View style={styles.actionsRow}>
            {actions.map((action) => {
              const iconColor = action.tintColor ?? palette.themeAccent;
              const isDisabled = Boolean(action.disabled || action.loading);
              return (
                <Pressable
                  key={action.id}
                  onPress={action.onPress}
                  disabled={isDisabled}
                  accessibilityRole="button"
                  accessibilityLabel={action.accessibilityLabel}
                  style={({ pressed }) => [
                    styles.circleButton,
                    {
                      backgroundColor: palette.bgCard,
                      borderColor: palette.separator,
                      opacity: isDisabled ? 0.55 : pressed ? 0.72 : 1,
                    },
                  ]}
                >
                  {action.loading ? (
                    <ActivityIndicator size="small" color={iconColor} />
                  ) : (
                    <SymbolView
                      name={action.symbol}
                      size={18}
                      weight="semibold"
                      tintColor={iconColor}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
    letterSpacing: 0.2,
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.4,
    lineHeight: 40,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 2,
  },
  circleButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
});
