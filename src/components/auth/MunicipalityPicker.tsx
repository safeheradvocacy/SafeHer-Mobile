import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, typography } from '../../constants/theme';
import { getMunicipalities } from '../../services/authService';
import type { Municipality } from '../../types/auth.types';

interface MunicipalityPickerProps {
  value: string | null;
  onChange: (municipality: Municipality) => void;
  error?: string;
}

export function MunicipalityPicker({ value, onChange, error }: MunicipalityPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    getMunicipalities().then((result) => {
      if (!isMounted) return;
      if (result.error) setLoadError(result.error);
      setMunicipalities(result.data ?? []);
      setIsLoading(false);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const selected = municipalities.find((m) => m.municipality_id === value);

  return (
    <View style={styles.wrapper}>
      <Pressable
        onPress={() => setIsOpen(true)}
        style={[styles.field, error ? styles.fieldError : null]}
        accessibilityRole="button"
      >
        <Ionicons name="business-outline" size={20} color={error ? colors.error : colors.outline} style={styles.icon} />
        <Text style={[styles.valueText, !selected ? styles.placeholderText : null]} numberOfLines={1}>
          {selected ? selected.municipality_name : 'Municipality'}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.outline} />
      </Pressable>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Modal visible={isOpen} animationType="slide" transparent onRequestClose={() => setIsOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setIsOpen(false)}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.sheetTitle}>Select Municipality</Text>

            {isLoading ? (
              <ActivityIndicator color={colors.primary} style={styles.loading} />
            ) : loadError ? (
              <Text style={styles.errorText}>{loadError}</Text>
            ) : (
              <FlatList
                data={municipalities}
                keyExtractor={(item) => item.municipality_id}
                style={styles.list}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.option}
                    onPress={() => {
                      onChange(item);
                      setIsOpen(false);
                    }}
                  >
                    <Text style={styles.optionText}>{item.municipality_name}</Text>
                    {item.municipality_id === value ? (
                      <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                    ) : null}
                  </Pressable>
                )}
              />
            )}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: '100%' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    backgroundColor: colors.white,
    paddingHorizontal: 16,
  },
  fieldError: { borderColor: colors.error },
  icon: { marginRight: 10 },
  valueText: { flex: 1, ...typography.bodyMd, color: colors.onSurface },
  placeholderText: { color: colors.outline },
  errorText: { ...typography.bodySm, fontSize: 12, color: colors.error, marginTop: 4, marginLeft: 4 },
  backdrop: { flex: 1, backgroundColor: 'rgba(27,28,28,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    maxHeight: '70%',
    paddingTop: 16,
    paddingBottom: 24,
  },
  sheetTitle: { ...typography.headlineMd, fontSize: 18, textAlign: 'center', marginBottom: 8, color: colors.onSurface },
  loading: { marginVertical: 24 },
  list: { paddingHorizontal: 24 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainerHigh,
  },
  optionText: { ...typography.bodyMd, color: colors.onSurface },
});
