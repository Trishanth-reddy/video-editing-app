import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Asset } from 'expo-asset';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';

export default function HomeScreen() {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(false);

  // ==========================================
  // 1. LOAD PRESET (ASSIGNMENT ASSET)
  // ==========================================
  const loadPresetProject = async () => {
    try {
      setLoading(true);
      
      // Ensure this path matches your project structure exactly!
      const baseVideoSource = require('../assets/videos/basevideo/A-roll.mp4');
      
      // Resolve asset to a local file URI
      const asset = Asset.fromModule(baseVideoSource);
      await asset.downloadAsync();

      const videoUri = asset.localUri || asset.uri;
      
      if (!videoUri) {
        Alert.alert("Error", "Could not resolve asset URI");
        return;
      }

      console.log('✅ Demo Loaded:', videoUri);
      navigation.navigate('Editor', { videoUri });
      
    } catch (error) {
      console.error(error);
      Alert.alert("Asset Error", "Ensure 'assets/videos/basevideo/A-roll.mp4' exists.\n" + error.message);
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // 2. PICK FROM GALLERY (REQUIREMENT)
  // ==========================================
  const pickVideo = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Need camera roll access to upload videos.');
      return;
    }

    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: false,
      quality: 1,
    });

    if (!result.canceled) {
      const videoUri = result.assets[0].uri;
      console.log('✅ Gallery Loaded:', videoUri);
      navigation.navigate('Editor', { videoUri });
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      
      <View style={styles.header}>
        <View style={styles.iconCircle}>
            <Ionicons name="cut" size={40} color="#1a1a1a" />
        </View>
        <Text style={styles.title}>Buttercut Studio</Text>
        <Text style={styles.sub}>AI Video Editor • v2.1</Text>
      </View>
      
      {/* OPTION 1: DEMO */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🚀 Quick Start</Text>
        <Text style={styles.cardDesc}>Use the assignment A-Roll asset</Text>
        
        <TouchableOpacity 
          style={styles.btnPrimary} 
          onPress={loadPresetProject} 
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <>
                <Ionicons name="flash" size={20} color="black" style={{marginRight: 8}}/>
                <Text style={styles.btnTextPrimary}>Load Demo Project</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <Text style={styles.orText}>— OR —</Text>

      {/* OPTION 2: GALLERY */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>📂 Custom Project</Text>
        <Text style={styles.cardDesc}>Select a video from your device</Text>

        <TouchableOpacity style={styles.btnSecondary} onPress={pickVideo}>
          <Ionicons name="folder-open" size={20} color="white" style={{marginRight: 8}}/>
          <Text style={styles.btnTextSecondary}>Open Gallery</Text>
        </TouchableOpacity>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center', padding: 20 },
  header: { alignItems: 'center', marginBottom: 40 },
  iconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#FFD369', justifyContent: 'center', alignItems: 'center', marginBottom: 15 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#fff' },
  sub: { color: '#666', marginTop: 5, letterSpacing: 1 },
  
  card: { backgroundColor: '#1E1E1E', padding: 20, borderRadius: 16, width: '100%', alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  cardTitle: { color: 'white', fontSize: 18, fontWeight: 'bold', marginBottom: 5 },
  cardDesc: { color: '#888', fontSize: 14, marginBottom: 20 },
  
  btnPrimary: { backgroundColor: '#FFD369', paddingVertical: 15, paddingHorizontal: 20, borderRadius: 12, width: '100%', flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  btnTextPrimary: { fontWeight: 'bold', fontSize: 16, color: 'black' },
  
  btnSecondary: { backgroundColor: '#333', paddingVertical: 15, paddingHorizontal: 20, borderRadius: 12, width: '100%', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#555' },
  btnTextSecondary: { fontWeight: 'bold', fontSize: 16, color: 'white' },

  orText: { color: '#444', marginVertical: 20, fontWeight: 'bold' }
});