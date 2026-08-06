import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing } from '../../utils/theme';

interface OnboardingItemProps {
  image: any; // require image
  title: string;
  description: string;
  badge?: string;
}

const OnboardingItem: React.FC<OnboardingItemProps> = ({
  image,
  title,
  description,
  badge,
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.imageContainer}>
        <Image source={image} style={styles.image} resizeMode="contain" />
      </View>
      <View style={styles.textContainer}>
        {badge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.marginMobile,
  },
  imageContainer: {
    flex: 0.6,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  image: {
    width: 260,
    height: 260,
  },
  textContainer: {
    flex: 0.4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  badge: {
    backgroundColor: Colors.tertiaryFixed,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 12,
  },
  badgeText: {
    ...Typography.labelSM,
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  title: {
    ...Typography.headlineLG_mobile,
    color: Colors.primary,
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    ...Typography.bodyMD,
    color: Colors.onSurfaceVariant,
    textAlign: 'center',
  },
});

export default OnboardingItem;
