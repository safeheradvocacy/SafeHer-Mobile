import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import OnboardingItem from '../../components/onboarding/OnboardingItem';
import PaginationDots from '../../components/common/PaginationDots';
import Button from '../../components/common/Button';
import { setItem, ONBOARDING_COMPLETE_KEY } from '../../utils/storage';
import { Colors, Spacing, Typography } from '../../utils/theme';

const { width } = Dimensions.get('window');

const onboardingData = [
  {
    id: '1',
    image: require('../../assets/images/onboarding1.png'),
    title: 'Report Safely',
    description: 'Submit confidential reports anytime and connect with trusted social welfare professionals.',
    badge: 'CONFIDENTIAL & SECURE',
  },
  {
    id: '2',
    image: require('../../assets/images/onboarding2.png'),
    title: 'Emergency SOS',
    description: 'Instantly send your live location during emergencies for faster response.',
    badge: 'ONE-TAP EMERGENCY',
  },
  {
    id: '3',
    image: require('../../assets/images/onboarding3.png'),
    title: 'Track Your Case',
    description: 'Monitor your report and receive updates throughout every stage of the case process.',
    badge: 'REAL-TIME UPDATES',
  },
];

const OnboardingScreen = () => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const navigation = useNavigation();

  const onContinue = () => {
    if (currentIndex < onboardingData.length - 1) {
      flatListRef.current?.scrollToIndex({
        index: currentIndex + 1,
        animated: true,
      });
    } else {
      handleGetStarted();
    }
  };

  const handleGetStarted = async () => {
    await setItem(ONBOARDING_COMPLETE_KEY, true);
    navigation.replace('Welcome');
  };

  const onSkip = () => {
    navigation.replace('Welcome');
  };

  const onScroll = (event: any) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / width);
    setCurrentIndex(index);
  };

  const renderItem = ({ item }: { item: typeof onboardingData[0] }) => (
    <OnboardingItem
      image={item.image}
      title={item.title}
      description={item.description}
      badge={item.badge}
    />
  );

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.skipButton} onPress={onSkip}>
        <Text style={styles.skipText}>Skip</Text>
      </TouchableOpacity>

      <FlatList
        ref={flatListRef}
        data={onboardingData}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      />

      <View style={styles.bottomContainer}>
        <PaginationDots total={onboardingData.length} activeIndex={currentIndex} />
        <Button
          title={currentIndex === onboardingData.length - 1 ? 'Get Started' : 'Continue'}
          onPress={onContinue}
          style={styles.continueButton}
        />
        <TouchableOpacity onPress={onSkip} style={styles.skipLink}>
          <Text style={styles.skipLinkText}>Skip</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  skipButton: {
    position: 'absolute',
    top: 40,
    right: Spacing.marginMobile,
    zIndex: 10,
    padding: 8,
  },
  skipText: {
    ...Typography.labelLG,
    color: Colors.primary,
  },
  bottomContainer: {
    paddingHorizontal: Spacing.marginMobile,
    paddingBottom: Spacing.sectionPadding,
    alignItems: 'center',
  },
  continueButton: {
    width: '100%',
    marginTop: Spacing.stackLG,
  },
  skipLink: {
    marginTop: Spacing.stackMD,
  },
  skipLinkText: {
    ...Typography.labelLG,
    color: Colors.outline,
  },
});

export default OnboardingScreen;
