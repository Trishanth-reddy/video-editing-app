import React, { useState, useEffect, useRef } from 'react';
import { 
  View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, 
  Alert, ScrollView, LogBox, LayoutAnimation, Platform, UIManager
} from 'react-native';
import axios from 'axios';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { Directory, File, Paths } from 'expo-file-system';

// 🛡️ Suppress Warnings
LogBox.ignoreLogs(['Method downloadAsync']);

// ⚡ Enable Layout Animation for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ✅ YOUR IP (Double check this matches ipconfig)
const API_BASE_URL = 'http://192.168.0.7:8000'; 

export default function ProcessingScreen({ route, navigation }) {
  const { videoUri, overlays: initialOverlays } = route.params;
  
  const [status, setStatus] = useState('initializing'); 
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState('Initializing Unlimited Pipeline...');
  const [jobId, setJobId] = useState(null);
  const [resultUrl, setResultUrl] = useState(null);
  
  const scrollViewRef = useRef();
  const isMounted = useRef(true);

  useEffect(() => {
    runUnlimitedPipeline();
    return () => { isMounted.current = false; };
  }, []);

  const addLog = (msg) => {
    setLog(prev => `> ${msg}\n${prev.substring(0, 1000)}`);
  };

  // ====================================================
  // 🚀 UNLIMITED TIMEOUT PIPELINE
  // ====================================================
  const runUnlimitedPipeline = async () => {
    try {
      // --- STAGE 1: PARALLEL ASSET UPLOAD ---
      setStatus('uploading');
      addLog('🚀 Starting Uploads...');

      const uploadPromises = initialOverlays.map(async (ov, index) => {
        if (ov.type !== 'image' && ov.type !== 'video') return ov;

        const formData = new FormData();
        const filename = ov.content.split('/').pop();
        
        formData.append('overlay', {
          uri: ov.content,
          name: filename,
          type: ov.type === 'video' ? 'video/mp4' : 'image/jpeg',
        });
        formData.append('type', ov.type);

        try {
          // 🛑 FIX 1: Timeout 0 (Infinity) for assets
          const response = await axios.post(`${API_BASE_URL}/upload-overlay`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 0, 
          });
          addLog(`✅ Asset ${index + 1} uploaded`);
          return { ...ov, content: response.data.filename };
        } catch (e) {
          throw new Error(`Failed to upload asset ${index + 1}`);
        }
      });

      const processedOverlays = await Promise.all(uploadPromises);

      // --- STAGE 2: MAIN VIDEO UPLOAD ---
      addLog('🎥 Uploading Main Video (This may take time)...');
      
      const mainFormData = new FormData();
      mainFormData.append('video', {
        uri: videoUri,
        name: 'main_video.mp4',
        type: 'video/mp4',
      });
      mainFormData.append('overlays', JSON.stringify(processedOverlays));

      // 🛑 FIX 2: Timeout 0 (Infinity) for Main Video
      const uploadRes = await axios.post(`${API_BASE_URL}/upload`, mainFormData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 0, // <--- CRITICAL FIX: NEVER TIMEOUT
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      const { job_id } = uploadRes.data;
      setJobId(job_id);
      addLog(`✅ Upload Complete. ID: ${job_id}`);
      
      // --- STAGE 3: POLLING ---
      setStatus('processing');
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      await smartPoll(job_id);

    } catch (error) {
      if (!isMounted.current) return;
      console.error(error);
      setStatus('error');
      addLog(`❌ ERROR: ${error.message}`);
      Alert.alert("Upload Failed", "Connection timed out or failed. Check PC IP.");
    }
  };

  const smartPoll = async (id) => {
    let pollingDelay = 1000;
    let errors = 0;

    while (isMounted.current) {
      try {
        const res = await axios.get(`${API_BASE_URL}/status/${id}`, { timeout: 5000 });
        const { status: jobStatus, progress: jobProgress, error } = res.data;

        errors = 0; 
        setProgress(jobProgress);

        if (jobStatus === 'completed') {
          setStatus('completed');
          setResultUrl(`${API_BASE_URL}/result/${id}`);
          addLog('✨ RENDER COMPLETE ✨');
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          return;
        } 
        
        if (jobStatus === 'failed') {
          setStatus('error');
          addLog(`❌ Server Error: ${error}`);
          return;
        }

        addLog(`⚙️ Rendering: ${jobProgress}%`);
        if (jobProgress > 50) pollingDelay = 2000;
        await new Promise(r => setTimeout(r, pollingDelay));

      } catch (e) {
        errors++;
        addLog(`⚠️ Reconnecting (${errors}/10)...`);
        if (errors > 10) {
          setStatus('error');
          addLog('❌ Lost connection to server.');
          return;
        }
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  };

  const handleDownload = async () => {
    if (!resultUrl) return;
    try {
      addLog('💾 Saving to Gallery...');
      
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert("Permission", "Gallery access required.");
        return;
      }

      const cacheDir = new Directory(Paths.cache, 'buttercut_edits');
      if (!cacheDir.exists) cacheDir.create();

      const filename = `render_${jobId}_${Date.now()}.mp4`;
      const destFile = new File(cacheDir, filename);
      
      addLog('⬇️ Downloading...');
      const download = await File.downloadFileAsync(resultUrl, destFile);
      
      addLog('📸 Adding to Album...');
      const asset = await MediaLibrary.createAssetAsync(download.uri);
      await MediaLibrary.createAlbumAsync('Buttercut Edits', asset, false);

      addLog('✅ DONE!');
      Alert.alert("Saved!", "Check your 'Buttercut Edits' album.");

    } catch (e) {
      Alert.alert("Save Error", e.message);
      addLog(`❌ Save Error: ${e.message}`);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.card, status === 'error' && styles.cardError]}>
        
        <View style={styles.iconContainer}>
          {status === 'completed' ? (
              <Ionicons name="checkmark-done-circle" size={100} color="#34C759" />
          ) : status === 'error' ? (
              <Ionicons name="alert-circle" size={100} color="#FF3B30" />
          ) : (
              <ActivityIndicator size="large" color="#007AFF" />
          )}
        </View>

        <Text style={styles.statusTitle}>
            {status === 'initializing' && 'Preparing...'}
            {status === 'uploading' && 'Uploading Large File...'}
            {status === 'processing' && `Rendering: ${progress}%`}
            {status === 'completed' && 'Render Complete!'}
            {status === 'error' && 'Failed'}
        </Text>

        {status === 'processing' && (
            <View style={styles.progressBarBg}>
                <View style={[styles.progressBarFill, { width: `${progress}%` }]} />
            </View>
        )}

        {status === 'completed' && (
            <TouchableOpacity style={styles.downloadBtn} onPress={handleDownload}>
                <Text style={styles.btnText}>Save to Gallery 📸</Text>
            </TouchableOpacity>
        )}

        <TouchableOpacity 
          style={styles.homeBtn} 
          onPress={() => navigation.navigate('Home')}
          disabled={status === 'uploading' || status === 'processing'}
        >
            <Text style={[styles.homeBtnText, (status === 'uploading' || status === 'processing') && {color: '#999'} ]}>
              Cancel / Home
            </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.console}>
        <Text style={styles.consoleHeader}>SYSTEM LOG</Text>
        <ScrollView ref={scrollViewRef}>
          <Text style={styles.consoleText}>{log}</Text>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F2F7', padding: 20, justifyContent: 'center' },
  card: { 
    backgroundColor: 'white', borderRadius: 24, padding: 30, alignItems: 'center', 
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 15, elevation: 10,
    marginBottom: 20
  },
  cardError: { borderColor: '#FF3B30', borderWidth: 2 },
  iconContainer: { marginBottom: 10 },
  statusTitle: { fontSize: 22, fontWeight: '800', marginVertical: 15, color: '#1C1C1E' },
  progressBarBg: { width: '100%', height: 12, backgroundColor: '#E5E5EA', borderRadius: 6, overflow: 'hidden', marginBottom: 25 },
  progressBarFill: { height: '100%', backgroundColor: '#007AFF' },
  downloadBtn: { 
    backgroundColor: '#34C759', paddingVertical: 16, paddingHorizontal: 32, 
    borderRadius: 16, width: '100%', alignItems: 'center', marginBottom: 12,
    shadowColor: '#34C759', shadowOpacity: 0.3, shadowOffset: {width: 0, height: 4}, elevation: 5
  },
  btnText: { color: 'white', fontWeight: 'bold', fontSize: 18 },
  homeBtn: { padding: 12 },
  homeBtnText: { color: '#007AFF', fontSize: 16, fontWeight: '600' },
  console: { 
    backgroundColor: '#1C1C1E', borderRadius: 16, padding: 16, height: 180,
    borderWidth: 1, borderColor: '#333'
  },
  consoleHeader: { color: '#666', fontSize: 10, fontWeight: 'bold', marginBottom: 8 },
  consoleText: { color: '#34C759', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11, lineHeight: 16 }
});