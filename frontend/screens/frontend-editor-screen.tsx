import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, ScrollView, 
  Dimensions, PanResponder, Image, Platform, TextInput, Modal, 
  KeyboardAvoidingView, Alert, Animated, LogBox
} from 'react-native';
import { useNavigation } from '@react-navigation/native'; // 👈 Added for Navigation
import { Asset } from 'expo-asset'; // 👈 Added for Asset resolution
import { Video, ResizeMode } from 'expo-av';
import { Ionicons } from '@expo/vector-icons'; 
import * as ImagePicker from 'expo-image-picker'; 
import * as Haptics from 'expo-haptics'; 

// 🛡️ IGNORE DEPRECATION WARNINGS
LogBox.ignoreLogs(['Video component from expo-av is deprecated']);

// ==========================================
// 1. CONSTANTS
// ==========================================
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const VIDEO_RATIO = 9 / 16;
const PREVIEW_HEIGHT = SCREEN_WIDTH * VIDEO_RATIO;
const PX_PER_SEC = 70; 
const SNAP_THRESHOLD_PX = 20; 
const MIN_DURATION = 0.5;
const MIN_CLIP_WIDTH_PX = MIN_DURATION * PX_PER_SEC;
const SCROLL_DEBOUNCE_MS = 50;

// Fallback Assets (Assignment Requirement)
const ASSETS = {
  base: require('../assets/videos/basevideo/A-roll.mp4'),
  b_rolls: [
    { id: 'b1', name: 'B-roll 1', type: 'video', src: require('../assets/videos/overlay/B-roll 1.mp4') },
    { id: 'b2', name: 'B-roll 2', type: 'video', src: require('../assets/videos/overlay/B-roll 2.mp4') },
  ]
};

// ==========================================
// 2. UTILS & HOOKS
// ==========================================
const roundToGrid = (val) => Math.round(val * 10) / 10;

const useHistory = (initialState) => {
  const [history, setHistory] = useState([initialState]);
  const [index, setIndex] = useState(0);

  const setState = (newState) => {
    const cleanHistory = history.slice(0, index + 1);
    setHistory([...cleanHistory, newState]);
    setIndex(cleanHistory.length);
  };

  const undo = () => index > 0 && setIndex(index - 1);
  const redo = () => index < history.length - 1 && setIndex(index + 1);

  return [history[index], setState, undo, redo, index > 0, index < history.length - 1];
};

// ==========================================
// 3. COMPONENT: Draggable Preview Overlay
// ==========================================
const DraggablePreviewItem = ({ item, isSelected, onSelect, onUpdate, isPlaying, currentTime }) => {
  const itemRef = useRef(item);
  itemRef.current = item;
  const initial = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const panPos = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      onSelect(itemRef.current.id);
      initial.current = { x: itemRef.current.x, y: itemRef.current.y };
    },
    onPanResponderMove: (_, g) => {
      const newX = Math.max(-50, Math.min(initial.current.x + g.dx, SCREEN_WIDTH - 50));
      const newY = Math.max(-50, Math.min(initial.current.y + g.dy, PREVIEW_HEIGHT - 50));
      onUpdate(itemRef.current.id, { x: newX, y: newY }, true);
    },
    onPanResponderRelease: (_, g) => {
      const newX = Math.max(-50, Math.min(initial.current.x + g.dx, SCREEN_WIDTH - 50));
      const newY = Math.max(-50, Math.min(initial.current.y + g.dy, PREVIEW_HEIGHT - 50));
      onUpdate(itemRef.current.id, { x: newX, y: newY }, false);
    }
  })).current;

  const panScale = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      initial.current = { w: itemRef.current.width, h: itemRef.current.height };
    },
    onPanResponderMove: (_, g) => {
      const newWidth = Math.max(50, initial.current.w + g.dx);
      const newHeight = Math.max(50, initial.current.h + g.dy);
      onUpdate(itemRef.current.id, { width: newWidth, height: newHeight }, true);
    },
    onPanResponderRelease: (_, g) => {
      const newWidth = Math.max(50, initial.current.w + g.dx);
      const newHeight = Math.max(50, initial.current.h + g.dy);
      onUpdate(itemRef.current.id, { width: newWidth, height: newHeight }, false);
    }
  })).current;

  if (currentTime < item.start_time || currentTime > item.start_time + item.duration) return null;

  return (
    <View style={[styles.previewItem, { left: item.x, top: item.y, width: item.width, height: item.height, zIndex: isSelected ? 999 : 10 }]}>
      <View {...panPos.panHandlers} style={[styles.previewInner, isSelected && styles.previewSelected]}>
        {item.type === 'video' && <Video source={item.src} style={{flex:1}} resizeMode="cover" shouldPlay={isPlaying} isMuted={true} />}
        {item.type === 'image' && <Image source={typeof item.src === 'string' ? {uri: item.src} : item.src} style={{flex:1, width:'100%', height:'100%'}} resizeMode="contain" />}
        {item.type === 'text' && <Text style={styles.previewText}>{item.text}</Text>}
      </View>
      {isSelected && (
        <View {...panScale.panHandlers} style={styles.resizeHandle}>
          <Ionicons name="resize" size={12} color="black" />
        </View>
      )}
    </View>
  );
};

// ==========================================
// 4. COMPONENT: Timeline Clip
// ==========================================
const TimelineClip = ({ clip, isSelected, onSelect, onUpdate, baseDuration, currentTime, setGlobalDragging }) => {
  const clipRef = useRef(clip);
  clipRef.current = clip;

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;
  const elevationAnim = useRef(new Animated.Value(2)).current;

  const [isDragging, setIsDragging] = useState(false);
  const dragInitialRef = useRef({ start: 0, duration: 0 });
  const didSnapRef = useRef(false);

  const width = clip.duration * PX_PER_SEC;
  const left = clip.start_time * PX_PER_SEC;

  const getSnappedTime = useCallback((rawTime) => {
    const snapPoints = [0, baseDuration - clipRef.current.duration, currentTime];
    let closest = null;
    let minDist = Infinity;
    snapPoints.forEach(pt => {
      const dist = Math.abs(pt - rawTime) * PX_PER_SEC;
      if (dist < SNAP_THRESHOLD_PX && dist < minDist) { closest = pt; minDist = dist; }
    });
    if (closest !== null && !didSnapRef.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      didSnapRef.current = true;
    } else if (closest === null) {
      didSnapRef.current = false;
    }
    return closest ?? rawTime;
  }, [baseDuration, currentTime]);

  const liftClip = () => {
    setGlobalDragging(true);
    setIsDragging(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1.15, useNativeDriver: true, friction: 5 }),
      Animated.timing(opacityAnim, { toValue: 0.85, duration: 100, useNativeDriver: true }),
    ]).start();
    Animated.timing(elevationAnim, { toValue: 10, duration: 100, useNativeDriver: false }).start();
  };

  const dropClip = () => {
    setGlobalDragging(false);
    setIsDragging(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, friction: 6 }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
    Animated.timing(elevationAnim, { toValue: 2, duration: 150, useNativeDriver: false }).start();
  };

  const panMain = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      onSelect(clipRef.current.id);
      dragInitialRef.current = { start: clipRef.current.start_time };
      liftClip();
    },
    onPanResponderMove: (_, gestureState) => {
      const dt = gestureState.dx / PX_PER_SEC;
      let newStart = dragInitialRef.current.start + dt;
      const maxStart = baseDuration - clipRef.current.duration;
      newStart = Math.max(0, Math.min(newStart, maxStart));
      const snappedStart = getSnappedTime(newStart);
      onUpdate(clipRef.current.id, { start_time: snappedStart }, true);
    },
    onPanResponderRelease: (_, gestureState) => {
      dropClip();
      const dt = gestureState.dx / PX_PER_SEC;
      let finalStart = dragInitialRef.current.start + dt;
      const maxStart = baseDuration - clipRef.current.duration;
      finalStart = Math.max(0, Math.min(finalStart, maxStart));
      finalStart = roundToGrid(finalStart); 
      onUpdate(clipRef.current.id, { start_time: finalStart }, false);
    }
  })).current;

  const panLeft = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => isSelected && !isDragging,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      liftClip();
      dragInitialRef.current = { start: clipRef.current.start_time, duration: clipRef.current.duration };
    },
    onPanResponderMove: (_, g) => {
      const dt = g.dx / PX_PER_SEC;
      let newStart = dragInitialRef.current.start + dt;
      let newDur = dragInitialRef.current.duration - dt;
      if (newDur >= MIN_DURATION && newStart >= 0 && (newDur * PX_PER_SEC) >= MIN_CLIP_WIDTH_PX) {
        onUpdate(clipRef.current.id, { start_time: newStart, duration: newDur }, true);
      }
    },
    onPanResponderRelease: () => { dropClip(); onUpdate(clipRef.current.id, {}, false); }
  })).current;

  const panRight = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => isSelected && !isDragging,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      liftClip();
      dragInitialRef.current = { duration: clipRef.current.duration };
    },
    onPanResponderMove: (_, g) => {
      const dt = g.dx / PX_PER_SEC;
      let newDur = dragInitialRef.current.duration + dt;
      if (newDur >= MIN_DURATION && (newDur * PX_PER_SEC) >= MIN_CLIP_WIDTH_PX) {
        onUpdate(clipRef.current.id, { duration: newDur }, true);
      }
    },
    onPanResponderRelease: () => { dropClip(); onUpdate(clipRef.current.id, {}, false); }
  })).current;

  return (
    <Animated.View style={[styles.clipContainer, { left, width, zIndex: isDragging ? 999 : (isSelected ? 20 : 1), transform: [{ scale: scaleAnim }], opacity: opacityAnim }]}>
      {isSelected && !isDragging && (
        <View {...panLeft.panHandlers} style={[styles.touchArea, { left: -15 }]}>
          <View style={[styles.handleVisual, { borderTopRightRadius: 0, borderBottomRightRadius: 0 }]}>
            <View style={styles.gripLine} />
          </View>
        </View>
      )}
      <Animated.View {...panMain.panHandlers} style={[
        styles.clipContent,
        { 
          backgroundColor: clip.type === 'video' ? '#5E81AC' : (clip.type === 'text' ? '#EBCB8B' : '#A3BE8C'),
          borderWidth: isSelected ? 2 : 1,
          borderColor: isSelected ? '#FFD369' : 'rgba(255,255,255,0.3)',
          borderRadius: isSelected ? 0 : 4,
          elevation: elevationAnim 
        }
      ]}>
        <Text numberOfLines={1} style={styles.clipText}>{clip.name}</Text>
        <Text style={styles.clipDuration}>
           {isDragging ? `${clip.start_time.toFixed(1)}s` : `${clip.duration.toFixed(1)}s`}
        </Text>
      </Animated.View>
      {isSelected && !isDragging && (
        <View {...panRight.panHandlers} style={[styles.touchArea, { right: -15 }]}>
          <View style={[styles.handleVisual, { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }]}>
            <View style={styles.gripLine} />
          </View>
        </View>
      )}
    </Animated.View>
  );
};

// ==========================================
// 6. MAIN CONTROLLER
// ==========================================
export default function EditorScreen({ route }) { // 👈 UPDATED: Access Route
  const navigation = useNavigation(); // 👈 UPDATED: Access Navigation
  
  // 🎥 1. GET VIDEO FROM HOME SCREEN OR FALLBACK TO ASSET
  const { videoUri: paramVideoUri } = route.params || {};
  
  const videoRef = useRef(null);
  const scrollRef = useRef(null);
  const overlaysRef = useRef([]);

  const [overlays, setOverlays, undo, redo, canUndo, canRedo] = useHistory([]);
  const [tempOverlays, setTempOverlays] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [baseDuration, setBaseDuration] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [isGlobalDragging, setIsGlobalDragging] = useState(false);

  const [showAssetModal, setShowAssetModal] = useState(false);
  const [showTextModal, setShowTextModal] = useState(false);
  const [inputText, setInputText] = useState('');

  const displayOverlays = tempOverlays || overlays;

  useEffect(() => {
    overlaysRef.current = overlays;
  }, [overlays]);

  // --- ACTIONS ---

  const addClip = async (item) => {
    let src = item.src;
    let type = item.type;
    let name = item.name;
    let duration = 3.0;

    if (item.id === 'gallery_upload') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return Alert.alert("Permission", "Needs gallery access");
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All, 
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      src = asset.uri;
      type = asset.type === 'video' ? 'video' : 'image';
      name = type === 'video' ? 'Video' : 'Image';
      if (asset.duration) duration = asset.duration / 1000;
    }

    const maxStart = baseDuration > 0 ? Math.max(0, baseDuration - duration) : 0;
    const spawnTime = Math.min(currentTime, maxStart);

    const newClip = {
      id: Date.now().toString(),
      type, name, src,
      text: item.text || '',
      start_time: spawnTime,
      duration: duration,
      x: SCREEN_WIDTH / 2 - 75,
      y: PREVIEW_HEIGHT / 2 - 75,
      width: 150, height: 150
    };

    setOverlays([...overlays, newClip]);
    setSelectedId(newClip.id);
    setShowAssetModal(false);
    setShowTextModal(false);
    setInputText('');
  };

  const addText = () => {
    if(inputText.trim()) {
      addClip({ type: 'text', name: 'Text', text: inputText });
    }
  };

  const updateClip = (id, updates, isTemp) => {
    const targetList = isTemp ? (tempOverlays || overlaysRef.current) : overlaysRef.current;
    const updatedList = targetList.map(c => c.id !== id ? c : { ...c, ...updates });
    if (isTemp) setTempOverlays(updatedList);
    else { setOverlays(updatedList); setTempOverlays(null); }
  };

  const deleteSelected = useCallback(() => {
    if (selectedId) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const newList = displayOverlays.filter(c => c.id !== selectedId);
      setOverlays(newList);
      setTempOverlays(null);
      setSelectedId(null);
    }
  }, [selectedId, displayOverlays]);

  const togglePlay = useCallback(async () => {
    if (videoRef.current) {
      if (isPlaying) await videoRef.current.pauseAsync();
      else await videoRef.current.playAsync();
      setIsPlaying(p => !p);
    }
  }, [isPlaying]);

  const handleScroll = useCallback((e) => {
    if(!isPlaying) {
      const x = e.nativeEvent.contentOffset.x;
      const time = x / PX_PER_SEC;
      setCurrentTime(time);
      if (videoRef.current) {
        videoRef.current.setPositionAsync(time * 1000, { toleranceMillisBefore: 100, toleranceMillisAfter: 100 });
      }
    }
  }, [isPlaying]);

  const onPlaybackStatusUpdate = (status) => {
    if (status.isLoaded) {
      setBaseDuration(status.durationMillis / 1000);
      if (status.isPlaying) {
        const time = status.positionMillis / 1000;
        setCurrentTime(time);
        scrollRef.current?.scrollTo({ x: time * PX_PER_SEC, animated: false });
      }
      if (status.didJustFinish) setIsPlaying(false);
    }
  };

  // 🚀 2. EXPORT LOGIC: CONNECT TO PROCESSING SCREEN
  // 🚀 2. EXPORT LOGIC: FIXING THE "CONTENT.SPLIT" ERROR
  const handleExport = async () => {
    try {
      if (isPlaying && videoRef.current) {
        await videoRef.current.pauseAsync();
        setIsPlaying(false);
      }

      // 1. Resolve Base Video URI
      let finalVideoUri = paramVideoUri;
      if (!finalVideoUri) {
        const asset = Asset.fromModule(ASSETS.base);
        await asset.downloadAsync();
        finalVideoUri = asset.localUri || asset.uri;
      }

      // 2. Resolve Overlay URIs (CRITICAL FIX)
      // We map this async to handle both 'require' assets (numbers) and gallery files (strings)
      const exportOverlays = await Promise.all(overlays.map(async (clip) => {
        let finalContent = clip.type === 'text' ? clip.text : clip.src;

        // If content is an Asset ID (Number), we must resolve it to a file URI
        if (typeof finalContent === 'number') {
            const asset = Asset.fromModule(finalContent);
            await asset.downloadAsync();
            finalContent = asset.localUri || asset.uri;
        }

        return {
            type: clip.type,
            content: finalContent, // Now guaranteed to be a String URI
            start_time: clip.start_time,
            end_time: clip.start_time + clip.duration,
            x: clip.x / SCREEN_WIDTH,
            y: clip.y / PREVIEW_HEIGHT,
            width: clip.width / SCREEN_WIDTH,
            height: clip.height / PREVIEW_HEIGHT,
        };
      }));

      // 3. Navigate
      navigation.navigate('Processing', {
        videoUri: finalVideoUri,
        overlays: exportOverlays
      });

    } catch (error) {
      console.error("Export Logic Error:", error);
      Alert.alert("Export Error", error.message);
    }
  };

  return (
    <View style={styles.container}>
      {/* --- TOP BAR --- */}
      <View style={styles.topToolbar}>
        <View style={{flexDirection:'row', gap:15}}>
          <TouchableOpacity onPress={undo} disabled={!canUndo} style={{opacity: canUndo ? 1 : 0.3}}>
            <Ionicons name="arrow-undo" size={24} color="white" />
          </TouchableOpacity>
          <TouchableOpacity onPress={redo} disabled={!canRedo} style={{opacity: canRedo ? 1 : 0.3}}>
            <Ionicons name="arrow-redo" size={24} color="white" />
          </TouchableOpacity>
        </View>
        
        {/* 🚀 3. EXPORT BUTTON */}
        <TouchableOpacity 
            onPress={handleExport} 
            style={styles.exportBtn}
        >
            <Text style={styles.exportText}>EXPORT</Text>
            <Ionicons name="arrow-forward" size={14} color="white" />
        </TouchableOpacity>

        {selectedId && (
          <TouchableOpacity onPress={deleteSelected} style={styles.deleteBtn}>
            <Ionicons name="trash-outline" size={18} color="white" />
          </TouchableOpacity>
        )}
      </View>

      {/* --- PREVIEW --- */}
      <View style={styles.previewContainer}>
        <Video
          ref={videoRef}
          // 🎥 USE DYNAMIC SOURCE
          source={paramVideoUri ? { uri: paramVideoUri } : ASSETS.base}
          style={StyleSheet.absoluteFill}
          resizeMode={ResizeMode.CONTAIN}
          onPlaybackStatusUpdate={onPlaybackStatusUpdate}
          progressUpdateIntervalMillis={50}
        />
        {displayOverlays.map(clip => (
          <DraggablePreviewItem 
            key={clip.id} 
            item={clip} 
            isSelected={selectedId === clip.id}
            isPlaying={isPlaying} 
            currentTime={currentTime} 
            onSelect={setSelectedId}
            onUpdate={updateClip}
          />
        ))}
      </View>

      {/* --- CONTROLS --- */}
      <View style={styles.midControls}>
        <TouchableOpacity style={styles.playBtn} onPress={togglePlay}>
          <Ionicons name={isPlaying ? "pause" : "play"} size={28} color="black" />
        </TouchableOpacity>
        <View style={{flexDirection:'row', gap:20}}>
          <TouchableOpacity style={styles.toolBtn} onPress={() => setShowAssetModal(true)}>
            <Ionicons name="images-outline" size={22} color="white" />
            <Text style={styles.btnTxt}>Media</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolBtn} onPress={() => setShowTextModal(true)}>
            <Ionicons name="text-outline" size={22} color="white" />
            <Text style={styles.btnTxt}>Text</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* --- TIMELINE --- */}
      <View style={styles.timelineContainer}>
        <View style={styles.playhead} />
        <ScrollView
          ref={scrollRef}
          horizontal
          scrollEnabled={!isGlobalDragging} 
          onScroll={handleScroll}
          scrollEventThrottle={16}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: SCREEN_WIDTH / 2, paddingBottom: 50 }}
        >
          <View style={{ height: '100%', minWidth: SCREEN_WIDTH }}>
            <View style={styles.ruler}>
              {Array.from({ length: Math.ceil(Math.max(baseDuration, 30)) }).map((_, i) => (
                <View key={i} style={[styles.tick, { left: i * PX_PER_SEC }]}>
                  <Text style={styles.tickText}>{i}s</Text>
                </View>
              ))}
            </View>
            <View style={styles.trackContainer}>
              <View style={[styles.baseTrack, { width: baseDuration * PX_PER_SEC }]}>
                <View style={{flex:1, flexDirection:'row', overflow:'hidden'}}>
                  {Array.from({length: Math.ceil(baseDuration)}).map((_,i) => (
                    <View key={i} style={{width: PX_PER_SEC, height:'100%', borderRightWidth:1, borderColor:'rgba(0,0,0,0.1)'}} />
                  ))}
                </View>
              </View>
            </View>
            <View style={styles.overlayTrackContainer}>
              {displayOverlays.map(clip => (
                <TimelineClip 
                  key={clip.id} clip={clip} 
                  isSelected={selectedId === clip.id}
                  onSelect={setSelectedId} onUpdate={updateClip}
                  baseDuration={baseDuration} currentTime={currentTime}
                  setGlobalDragging={setIsGlobalDragging}
                />
              ))}
            </View>
          </View>
        </ScrollView>
      </View>

      {/* --- MODALS --- */}
      <Modal visible={showAssetModal} transparent animationType="fade">
        <TouchableOpacity activeOpacity={1} onPress={() => setShowAssetModal(false)} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Layer</Text>
            <TouchableOpacity style={styles.modalItem} onPress={() => addClip({ id: 'gallery_upload' })}>
              <Ionicons name="add-circle" size={24} color="#FFD369" />
              <Text style={{color:'white', marginLeft: 10}}>Gallery (Video/Image)</Text>
            </TouchableOpacity>
            {ASSETS.b_rolls.map(asset => (
              <TouchableOpacity key={asset.id} style={styles.modalItem} onPress={() => addClip(asset)}>
                <Ionicons name="videocam" size={24} color="#4A90E2" />
                <Text style={{color:'white', marginLeft: 10}}>{asset.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showTextModal} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Text</Text>
            <TextInput style={styles.textInput} value={inputText} onChangeText={setInputText} placeholder="Type subtitle..." placeholderTextColor="#666" autoFocus />
            <TouchableOpacity style={styles.confirmBtn} onPress={addText}>
              <Text style={{fontWeight:'bold', color:'black'}}>ADD</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ==========================================
// 7. STYLES
// ==========================================
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  topToolbar: {
    height: 50, backgroundColor: '#1E1E1E', flexDirection: 'row', 
    alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20,
    borderBottomWidth: 1, borderColor: '#2A2A2A', marginTop: 40
  },
  deleteBtn: { backgroundColor: '#FF3B30', width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  exportBtn: { 
    backgroundColor: '#34C759', paddingHorizontal: 12, paddingVertical: 6, 
    borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 5 
  },
  exportText: { color: 'white', fontWeight: 'bold', fontSize: 12 },
  
  previewContainer: { width: SCREEN_WIDTH, height: PREVIEW_HEIGHT, backgroundColor: '#000', overflow:'hidden' },
  previewItem: { position: 'absolute' },
  previewInner: { flex: 1, borderWidth: 1, borderColor: 'rgba(255,255,255,0)' }, 
  previewSelected: { borderColor: '#FFD369', borderWidth: 2 }, 
  previewText: { color: 'white', fontWeight:'bold', fontSize: 24, textShadowRadius: 3, textShadowColor:'black', textAlign:'center' },
  resizeHandle: { position: 'absolute', right: -10, bottom: -10, width: 24, height: 24, backgroundColor: '#FFD369', borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFF', zIndex: 101 },
  
  midControls: { height: 70, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 40, backgroundColor: '#1E1E1E' },
  playBtn: { backgroundColor: '#FFD369', width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  toolBtn: { alignItems: 'center', opacity: 0.9 },
  btnTxt: { color: 'white', fontSize: 10, marginTop: 4, fontWeight: '600' },
  
  timelineContainer: { flex: 1, backgroundColor: '#181818', marginTop: 1 },
  playhead: { position: 'absolute', left: SCREEN_WIDTH / 2, top: 0, bottom: 0, width: 2, backgroundColor: '#fff', zIndex: 999, pointerEvents: 'none' },
  ruler: { height: 24, backgroundColor: '#1E1E1E', borderBottomWidth: 1, borderColor: '#333' },
  tick: { position: 'absolute', top: 0, height: 10, borderLeftWidth: 1, borderColor: '#555', marginTop: 14 },
  tickText: { color: '#888', fontSize: 9, marginLeft: 3, marginTop: -12 },
  trackContainer: { marginTop: 10, paddingBottom: 10 },
  overlayTrackContainer: { marginTop: 5, height: 100 }, 
  baseTrack: { height: 45, backgroundColor: '#2E3440', borderRadius: 4, overflow: 'hidden' },
  
  clipContainer: { position: 'absolute', height: 45, top: 0, justifyContent: 'center' },
  clipContent: { flex: 1, borderRadius: 4, paddingHorizontal: 8, justifyContent: 'center', overflow: 'hidden' },
  clipText: { color: 'black', fontSize: 11, fontWeight: '700' },
  clipDuration: { color: 'rgba(0,0,0,0.5)', fontSize: 9, fontWeight: '600' },
  touchArea: { position: 'absolute', top: 0, bottom: 0, width: 30, zIndex: 20, justifyContent: 'center', alignItems: 'center' },
  handleVisual: { width: 14, height: '100%', backgroundColor: '#FFD369', borderRadius: 4, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'white' },
  gripLine: { width: 2, height: 12, backgroundColor: 'black', opacity: 0.4, borderRadius: 1 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: 280, backgroundColor: '#222', padding: 20, borderRadius: 16, borderWidth:1, borderColor:'#333' },
  modalTitle: { color: 'white', fontSize: 16, fontWeight: 'bold', marginBottom: 20, textAlign:'center' },
  modalItem: { flexDirection: 'row', alignItems:'center', padding: 15, borderBottomWidth: 1, borderColor: '#333' },
  textInput: { backgroundColor: '#333', color: 'white', padding: 12, borderRadius: 8, marginBottom: 20, fontSize: 16 },
  confirmBtn: { backgroundColor: '#FFD369', padding: 12, borderRadius: 8, alignItems: 'center' }
});