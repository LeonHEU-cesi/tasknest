import { StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Tasknest</Text>
      <Text style={styles.subtitle}>Plan your tasks. Sync your life. Own your data.</Text>
      <Text style={styles.note}>
        Pre-alpha scaffold &mdash; full mobile UI lands in later sprints.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    opacity: 0.85,
  },
  note: {
    fontSize: 12,
    opacity: 0.6,
    textAlign: 'center',
  },
});
