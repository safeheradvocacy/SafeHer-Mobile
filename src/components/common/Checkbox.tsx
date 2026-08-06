import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import { Colors } from '../../utils/theme';

interface CheckboxProps {
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

const Checkbox: React.FC<CheckboxProps> = ({ checked, onToggle, disabled = false }) => {
  return (
    <TouchableOpacity
      onPress={onToggle}
      disabled={disabled}
      activeOpacity={0.7}
      style={[styles.container, checked && styles.checked]}
    >
      {checked && <Icon name="check" size={18} color={Colors.onPrimary} />}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: Colors.outline,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  checked: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
});

export default Checkbox;
