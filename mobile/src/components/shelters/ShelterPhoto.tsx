import React, { useState } from 'react';
import { View, Image, ActivityIndicator, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { shelterPhotoUrl } from '../../lib/shelterPhotos';

/**
 * Shared image treatment for both the shelter card thumbnail and the
 * details screen's hero photo — sizing/aspect ratio is entirely the
 * caller's via `style` (a bare View, no fixed dimensions here), so the
 * same component serves a small square thumbnail and a wide hero banner.
 *
 * Uses plain react-native Image rather than adding expo-image: Supabase
 * Storage's public URLs already serve standard Cache-Control headers, so
 * the OS-level HTTP cache (NSURLCache on iOS, OkHttp's cache on Android)
 * already gives real repeat-view caching without a new dependency — see
 * the final report for the explicit reasoning. A broken/expired/deleted
 * URL falls back to the same neutral placeholder a missing photo uses,
 * never a blank gap or a crash (brief: "failed image loads do not break
 * the screen").
 */
export function ShelterPhoto({ path, style, iconSize = 28 }: { path: string | null | undefined; style?: StyleProp<ViewStyle>; iconSize?: number }) {
  const { palette } = useTheme();
  const url = shelterPhotoUrl(path);
  const [loading, setLoading] = useState(!!url);
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    return (
      <View style={[styles.placeholder, { backgroundColor: palette.surfaceMuted }, style]}>
        <Ionicons name="home-outline" size={iconSize} color={palette.textMuted} />
      </View>
    );
  }

  return (
    <View style={[styles.placeholder, { backgroundColor: palette.surfaceMuted }, style]}>
      <Image
        source={{ uri: url }}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
        accessibilityIgnoresInvertColors
      />
      {loading ? <ActivityIndicator color={palette.primary} style={StyleSheet.absoluteFill} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
