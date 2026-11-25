/**
 * iOS 18-styled segmented control for switching quota metric tabs.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useIos18Palette } from '../theme/tokens';

export interface SegmentOption<T extends string> {
  key: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const palette = useIos18Palette();

  return (
    <View style={[styles.track, { backgroundColor: palette.bgSecondaryFill }]}>
      {options.map((option) => {
        const isActive = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            style={[
              styles.segment,
              isActive && [
                styles.activeSegment,
                {
                  backgroundColor: palette.isDark ? '#636366' : '#FFFFFF',
                },
              ],
            ]}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              style={[
                styles.label,
                {
                  color: palette.textPrimary,
                  fontWeight: isActive ? '600' : '500',
                },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 2,
    gap: 2,
  },
  segment: {
    flex: 1,
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeSegment: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
  },
  label: {
    fontSize: 13,
  },
});
