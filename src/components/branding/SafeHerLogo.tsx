import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { fontFamily } from '../../constants/theme';

interface SafeHerLogoProps {
  size?: number;
  showWordmark?: boolean;
}

/**
 * Original shield-and-heart mark for the SafeHer brand: a protective
 * shield outline with a heart at its center, rendered in the primary
 * violet gradient. Intentionally simple/geometric — not a reproduction
 * of the illustrated Stitch mockup artwork.
 */
export function SafeHerLogo({ size = 96, showWordmark = true }: SafeHerLogoProps) {
  return (
    <View style={styles.wrapper}>
      <Svg width={size} height={size} viewBox="0 0 96 96">
        <Defs>
          <LinearGradient id="shieldGradient" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#7C5CFA" />
            <Stop offset="1" stopColor="#5B3FD6" />
          </LinearGradient>
        </Defs>
        <Path
          d="M48 6 L82 18 V44 C82 66 68 82 48 90 C28 82 14 66 14 44 V18 Z"
          fill="none"
          stroke="url(#shieldGradient)"
          strokeWidth={5}
          strokeLinejoin="round"
        />
        <Path
          d="M48 58 C36 48 30 41 30 33.5 C30 27.5 34.7 23 40.5 23 C43.9 23 47 24.7 48 27.4 C49 24.7 52.1 23 55.5 23 C61.3 23 66 27.5 66 33.5 C66 41 60 48 48 58 Z"
          fill="url(#shieldGradient)"
        />
      </Svg>
      {showWordmark ? (
        <Text style={styles.wordmark}>
          Safe<Text style={styles.wordmarkAccent}>Her</Text>
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center' },
  wordmark: {
    marginTop: 12,
    fontFamily: fontFamily.headingBold,
    fontSize: 32,
    color: '#2A1B6B',
  },
  wordmarkAccent: {
    color: '#E0409B',
  },
});
