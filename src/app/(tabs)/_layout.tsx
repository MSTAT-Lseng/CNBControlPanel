/**
 * Bottom tab bar layout powered by expo-router/native-tabs.
 * Renders the system iOS 26 Liquid Glass tab bar with four tabs:
 * Overview, Accounts, Usage, and Settings.
 */

import React from 'react';
import { NativeTabs } from 'expo-router/native-tabs';
import { useIos18Palette } from '@/services/ui';

export default function TabsLayout() {
  const palette = useIos18Palette();

  return (
    <NativeTabs tintColor={palette.themeAccent}>
      <NativeTabs.Trigger name="index" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>概览</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'chart.bar', selected: 'chart.bar.fill' }}
          md="bar_chart"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="accounts" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>账户</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person.2', selected: 'person.2.fill' }}
          md="group"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="usage" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>用量</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{
            default: 'gauge.with.dots.needle.33percent',
            selected: 'gauge.with.dots.needle.67percent',
          }}
          md="speed"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>设置</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'gearshape', selected: 'gearshape.fill' }}
          md="settings"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
