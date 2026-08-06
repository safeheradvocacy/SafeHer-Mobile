import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Colors } from '../../utils/theme';

interface PaginationDotsProps {
  total: number;
  activeIndex: number;
}

const PaginationDots: React.FC<PaginationDotsProps> = ({ total, activeIndex }) => {
  return (
    <View style={styles.container}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            i === activeIndex ? styles.activeDot : styles.inactiveDot,
            i === activeIndex && { width: 32 },
          ]}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.outlineVariant,
    width: 8,
  },
  activeDot: {
    backgroundColor: Colors.primary,
    width: 32,
  },
  inactiveDot: {
    backgroundColor: Colors.outlineVariant,
  },
});

export default PaginationDots;
