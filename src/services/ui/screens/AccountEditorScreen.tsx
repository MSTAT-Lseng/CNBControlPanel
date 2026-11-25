/**
 * Standalone Create/Edit Account screen rendered inside a native iOS 18 Stack header.
 * Allows entering username, cookie, and optional remark on create;
 * locks username and allows editing cookie and remark on edit.
 */

import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { exchangeService } from '@/services/exchange';
import { useIos18Palette } from '../theme/tokens';

export function AccountEditorScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const palette = useIos18Palette();
  const params = useLocalSearchParams<{ username?: string }>();

  const editingUsername = typeof params.username === 'string' ? params.username.trim() : '';
  const isEditMode = editingUsername.length > 0;

  const [username, setUsername] = useState(editingUsername);
  const [cookie, setCookie] = useState('');
  const [remark, setRemark] = useState('');
  const [isLoadingInitial, setIsLoadingInitial] = useState(isEditMode);
  const [isSaving, setIsSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditMode) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const res = await exchangeService.getAccountForEdit(editingUsername);
      if (cancelled) {
        return;
      }
      if (res.ok) {
        setUsername(res.data.username);
        setCookie(res.data.cookie);
        setRemark(res.data.remark);
      } else {
        setErrorText(res.error.message);
      }
      setIsLoadingInitial(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [editingUsername, isEditMode]);

  const handleSave = useCallback(async () => {
    if (isSaving || isLoadingInitial) {
      return;
    }

    setErrorText(null);
    setIsSaving(true);
    try {
      const res = isEditMode
        ? await exchangeService.updateAccount({ username, cookie, remark })
        : await exchangeService.createAccount({ username, cookie, remark });

      if (!res.ok) {
        setErrorText(res.error.message);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } finally {
      setIsSaving(false);
    }
  }, [cookie, isEditMode, isLoadingInitial, isSaving, remark, router, username]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: isEditMode ? '编辑账户' : '新建账户',
      headerStyle: { backgroundColor: palette.bgCard },
      headerTintColor: palette.accentBlue,
      headerTitleStyle: { color: palette.textPrimary },
      headerRight: () => (
        <Pressable
          onPress={() => void handleSave()}
          disabled={isSaving || isLoadingInitial}
          hitSlop={8}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={palette.accentBlue} />
          ) : (
            <Text style={[styles.headerSaveText, { color: palette.accentBlue }]}>保存</Text>
          )}
        </Pressable>
      ),
    });
  }, [handleSave, isEditMode, isLoadingInitial, isSaving, navigation, palette]);

  const handlePasteCookie = async () => {
    const pasted = await Clipboard.getStringAsync();
    if (!pasted.trim()) {
      Alert.alert('剪贴板为空', '未检测到可粘贴的 Cookie 内容。');
      return;
    }
    setCookie(pasted.trim());
    void Haptics.selectionAsync();
  };

  if (isLoadingInitial) {
    return (
      <View style={[styles.loadingCenter, { backgroundColor: palette.bgCanvas }]}>
        <ActivityIndicator size="large" color={palette.accentBlue} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: palette.bgCanvas }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 32 },
        ]}
      >
        {errorText ? (
          <View
            style={[
              styles.errorBanner,
              {
                backgroundColor: palette.dangerBannerBg,
                borderColor: palette.dangerBannerBorder,
              },
            ]}
          >
            <SymbolView name="exclamationmark.circle.fill" size={18} tintColor={palette.accentRed} />
            <Text style={[styles.errorText, { color: palette.accentRed }]}>{errorText}</Text>
          </View>
        ) : null}

        <View style={styles.sectionBlock}>
          <Text style={[styles.sectionLabel, { color: palette.textSecondary }]}>账户标识</Text>
          <View style={[styles.groupCard, { backgroundColor: palette.bgCard }]}>
            <View style={styles.fieldRow}>
              <View style={styles.fieldLabelRow}>
                <Text style={[styles.fieldLabel, { color: palette.textPrimary }]}>用户名 (username)</Text>
                {isEditMode ? (
                  <View style={styles.lockedTag}>
                    <SymbolView name="lock.fill" size={11} tintColor={palette.textSecondary} />
                    <Text style={[styles.lockedTagText, { color: palette.textSecondary }]}>
                      不可更改
                    </Text>
                  </View>
                ) : null}
              </View>
              <TextInput
                value={username}
                onChangeText={setUsername}
                editable={!isEditMode}
                placeholder="输入 CNB 用户名或组织标识"
                placeholderTextColor={palette.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  styles.textInput,
                  {
                    color: isEditMode ? palette.textSecondary : palette.textPrimary,
                  },
                ]}
              />
            </View>
          </View>
        </View>

        <View style={styles.sectionBlock}>
          <View style={styles.labelWithAction}>
            <Text style={[styles.sectionLabel, { color: palette.textSecondary }]}>认证凭证</Text>
            <Pressable onPress={() => void handlePasteCookie()} hitSlop={8}>
              <Text style={[styles.pasteAction, { color: palette.accentBlue }]}>从剪贴板粘贴</Text>
            </Pressable>
          </View>
          <View style={[styles.groupCard, { backgroundColor: palette.bgCard }]}>
            <View style={styles.fieldRow}>
              <Text style={[styles.fieldLabel, { color: palette.textPrimary }]}>Cookie</Text>
              <TextInput
                value={cookie}
                onChangeText={setCookie}
                placeholder="粘贴完整 CNB 请求 Cookie 字符串"
                placeholderTextColor={palette.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                textAlignVertical="top"
                style={[
                  styles.multilineInput,
                  {
                    color: palette.textPrimary,
                  },
                ]}
              />
            </View>
          </View>
          <Text style={[styles.helperText, { color: palette.textSecondary }]}>
            Cookie 将通过 iOS 钥匙串 (Keychain) 安全隔离保存。
          </Text>
        </View>

        <View style={styles.sectionBlock}>
          <Text style={[styles.sectionLabel, { color: palette.textSecondary }]}>附加信息（可选）</Text>
          <View style={[styles.groupCard, { backgroundColor: palette.bgCard }]}>
            <View style={styles.fieldRow}>
              <Text style={[styles.fieldLabel, { color: palette.textPrimary }]}>备注</Text>
              <TextInput
                value={remark}
                onChangeText={setRemark}
                placeholder="例如：个人主力号 / 高校特权组织"
                placeholderTextColor={palette.textTertiary}
                style={[styles.textInput, { color: palette.textPrimary }]}
              />
            </View>
          </View>
        </View>

        <Pressable
          onPress={() => void handleSave()}
          disabled={isSaving}
          style={({ pressed }) => [
            styles.submitButton,
            {
              backgroundColor: palette.accentBlue,
              opacity: isSaving ? 0.6 : pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text style={styles.submitButtonText}>
            {isSaving ? '正在保存...' : isEditMode ? '保存修改' : '添加账户'}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSaveText: {
    fontSize: 17,
    fontWeight: '600',
  },
  scrollContent: {
    padding: 16,
    gap: 18,
  },
  errorBanner: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  sectionBlock: {
    gap: 6,
  },
  labelWithAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 14,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '500',
    paddingHorizontal: 14,
  },
  pasteAction: {
    fontSize: 13,
    fontWeight: '600',
  },
  groupCard: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  fieldRow: {
    gap: 8,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  lockedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  lockedTagText: {
    fontSize: 12,
  },
  textInput: {
    fontSize: 16,
    paddingVertical: 6,
  },
  multilineInput: {
    fontSize: 14,
    fontFamily: 'Menlo',
    minHeight: 112,
    paddingVertical: 6,
  },
  helperText: {
    fontSize: 12,
    paddingHorizontal: 14,
  },
  submitButton: {
    marginTop: 6,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
