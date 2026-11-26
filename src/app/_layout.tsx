/**
 * Root Expo Router Stack layout.
 * Restores classic iOS 18 opaque native stack headers on iOS 26+ while hosting
 * the iOS 26 Liquid Glass NativeTabs group and standalone Stack pages.
 */

import React from 'react';
import { enableLegacyHeaderAppearance, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useExchangeBootstrap, useIos18Palette } from '@/services/ui';

// Keep all native Stack headers in classic iOS 18 opaque style instead of iOS 26 Liquid Glass.
enableLegacyHeaderAppearance();

export default function RootLayout() {
  useExchangeBootstrap();
  const palette = useIos18Palette();

  const ios18NativeHeaderOptions = {
    headerShown: true,
    headerTransparent: false,
    headerBlurEffect: undefined,
    headerShadowVisible: true,
    headerBackButtonDisplayMode: 'minimal' as const,
    headerStyle: {
      backgroundColor: palette.bgCard,
    },
    headerTintColor: palette.themeAccent,
    headerTitleStyle: {
      color: palette.textPrimary,
      fontWeight: '600' as const,
    },
    contentStyle: {
      backgroundColor: palette.bgCanvas,
    },
  };

  return (
    <SafeAreaProvider>
      <StatusBar style={palette.isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="account-editor"
          options={{
            ...ios18NativeHeaderOptions,
            title: '账户',
          }}
        />
        <Stack.Screen
          name="workspaces"
          options={{
            ...ios18NativeHeaderOptions,
            title: '云原生开发',
          }}
        />
        <Stack.Screen
          name="workspace-history"
          options={{
            ...ios18NativeHeaderOptions,
            title: '容器历史',
          }}
        />
        <Stack.Screen
          name="workspace-logs"
          options={{
            ...ios18NativeHeaderOptions,
            title: '构建日志',
          }}
        />
        <Stack.Screen
          name="logs"
          options={{
            ...ios18NativeHeaderOptions,
            title: '运行日志',
          }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}
