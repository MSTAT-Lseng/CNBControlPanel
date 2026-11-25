/**
 * iOS 18-styled segmented control with optional left SF Symbols and smooth sliding thumb animation.
 */

import React, { useEffect, useState } from 'react';
import {
  Animated,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useIos18Palette } from '../theme/tokens';

export interface SegmentOption<T extends string> {
  key: T;
  label: string;
  symbol?: SFSymbol;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
}

const TRACK_PADDING = 2;
const SEGMENT_GAP = 2;

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const palette = useIos18Palette();
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.key === value),
  );
  const [trackWidth, setTrackWidth] = useState(0);
  const [slideAnim] = useState(() => new Animated.Value(activeIndex));

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: activeIndex,
      stiffness: 320,
      damping: 28,
      mass: 0.85,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, slideAnim]);

  const count = options.length;
  const innerWidth = Math.max(0, trackWidth - TRACK_PADDING * 2);
  const segmentWidth =
    count > 0 ? Math.max(0, (innerWidth - SEGMENT_GAP * (count - 1)) / count) : 0;
  const maxIndex = Math.max(1, count - 1);
  const translateX = slideAnim.interpolate({
    inputRange: [0, maxIndex],
    outputRange: [0, maxIndex * (segmentWidth + SEGMENT_GAP)],
  });

  const handleTrackLayout = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.width;
    if (Math.abs(measured - trackWidth) > 0.5) {
      setTrackWidth(measured);
    }
  };

  const thumbBackground = palette.isDark ? '#636366' : '#FFFFFF';

  return (
    <View
      onLayout={handleTrackLayout}
      style={[styles.track, { backgroundColor: palette.bgSecondaryFill }]}
    >
      {trackWidth > 0 && segmentWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.slidingThumb,
            {
              width: segmentWidth,
              backgroundColor: thumbBackground,
              transform: [{ translateX }],
            },
          ]}
        />
      ) : null}

      {options.map((option) => {
        const isActive = option.key === value;
        const showFallbackHighlight = trackWidth <= 0 && isActive;
        const iconColor = isActive ? palette.textPrimary : palette.textSecondary;

        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            style={[
              styles.segment,
              showFallbackHighlight && [
                styles.activeSegmentFallback,
                { backgroundColor: thumbBackground },
              ],
            ]}
          >
            {option.symbol ? (
              <SymbolView
                name={option.symbol}
                size={13}
                weight={isActive ? 'semibold' : 'medium'}
                tintColor={iconColor}
              />
            ) : null}
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
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
    padding: TRACK_PADDING,
    gap: SEGMENT_GAP,
    position: 'relative',
  },
  slidingThumb: {
    position: 'absolute',
    left: TRACK_PADDING,
    top: TRACK_PADDING,
    bottom: TRACK_PADDING,
    borderRadius: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    zIndex: 1,
  },
  activeSegmentFallback: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
  },
  label: {
    fontSize: 13,
    flexShrink: 1,
  },
});
