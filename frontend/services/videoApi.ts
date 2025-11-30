import axios from 'axios';
import { Platform } from 'react-native';

// Replace with your actual local IP or Render URL
// If testing on Android Emulator, use 'http://10.0.2.2:8000'
const BASE_URL = 'http://192.168.1.X:8000'; 

export interface Overlay {
  type: 'text' | 'image' | 'video';
  content: string; // Text string or filename from upload-overlay
  start_time: number;
  end_time: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  opacity?: number;
}

export const videoApi = {
  // 1. Upload Overlay Media (Image/Video)
  uploadOverlayMedia: async (uri: string, type: 'image' | 'video') => {
    const formData = new FormData();
    const filename = uri.split('/').pop() || `overlay_${Date.now()}`;
    
    // @ts-ignore: React Native FormData signature difference
    formData.append('overlay', {
      uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
      type: type === 'image' ? 'image/png' : 'video/mp4',
      name: filename,
    });
    formData.append('overlay_type', type);

    const response = await axios.post(`${BASE_URL}/upload-overlay`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data.filename; // Returns the server-generated filename
  },

  // 2. Upload Main Video & Start Job
  processVideo: async (videoUri: string, overlays: Overlay[]) => {
    const formData = new FormData();
    const filename = videoUri.split('/').pop() || `video_${Date.now()}.mp4`;

    // @ts-ignore
    formData.append('video', {
      uri: Platform.OS === 'ios' ? videoUri.replace('file://', '') : videoUri,
      type: 'video/mp4',
      name: filename,
    });
    
    // Send overlays as a stringified JSON
    formData.append('overlays', JSON.stringify(overlays));

    const response = await axios.post(`${BASE_URL}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data.job_id;
  },

  // 3. Poll Status
  getJobStatus: async (jobId: string) => {
    const response = await axios.get(`${BASE_URL}/status/${jobId}`);
    return response.data;
  },

  // 4. Get Result URL
  getResultUrl: (jobId: string) => {
    return `${BASE_URL}/result/${jobId}`;
  }
};