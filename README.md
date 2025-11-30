---

# 🎥 Video Editor 

A mobile video editing application built with **React Native (Expo)** and **Python (FastAPI)**. Users can upload videos, add text/image/video overlays, position them on a timeline, and render the final result using server-side FFmpeg.

---

## 🚀 Features

### **Frontend**

* Upload from Gallery
* Drag & Drop Overlay Positioning
* Timeline Trimming & Duration Control
* Text / Image / Video Overlays
* Live Preview (Expo AV)

### **Backend**

* Asynchronous FFmpeg Rendering
* Status Polling via `/status/{job_id}`
* Final video streaming via `/result/{job_id}`
* Real-time progress parsing

### **Extras**

* Upload progress bar
* Multi-stage overlay uploading
* Automatic cleanup of temporary files

---

## 🛠️ Setup & Installation

### **1. Prerequisites**

* **Node.js** & **npm**
* **Python 3.9+**
* **FFmpeg** (must be installed + added to PATH)
* **Expo Go App** on your mobile device

---

## **2. Backend Setup (Python)**

The backend handles video processing and overlay rendering.

```bash
cd backend

# Create virtual environment (optional)
python -m venv venv

# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

# Install dependencies
pip install fastapi uvicorn python-multipart pydantic

# Run server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

> **Tip:** Open `http://YOUR_PC_IP:8000` on your phone to confirm connectivity.

---

## **3. Frontend Setup (React Native)**

```bash
cd frontend

# Install dependencies
npx expo install
```

### ⚠️ **CRITICAL CONFIGURATION**

Open:

```
screens/ProcessingScreen.js
```

Update:

```js
const API_BASE_URL = "http://<YOUR_LOCAL_IP>:8000";
```

Example:

```
http://192.168.1.5:8000
```

Then run:

```bash
npx expo start
```

Scan the QR code with your phone.

---

## 📸 Usage Flow

1. **Home Screen** → select the base video from gallery
2. **Editor Screen**

   * Add **Images / Videos / Text**
   * **Drag** overlays to position them
   * **Trim** their time duration on the timeline
3. **Export**
4. **Processing Screen**

   * App uploads overlays → uploads video → polls backend
5. **Download**

   * Save final MP4 to your device’s gallery

---

## 🏗️ Architecture Overview

### **Client (React Native)**

* Sends overlays via `/upload-overlay`
* Sends final metadata + base video to `/upload`
* Polls server for progress

### **Server (FastAPI)**

* Generates `job_id`
* Writes job status to `jobs/{id}.json`
* Spawns FFmpeg as background task
* Streams final output from `/result/{job_id}`

### **Worker (FFmpeg)**

* Maps all overlay inputs
* Scales & positions assets
* Applies timing constraints
* Renders final MP4

---

## 📝 API Endpoints

| Method   | Endpoint           | Description                  |
| -------- | ------------------ | ---------------------------- |
| **POST** | `/upload`          | Start a video render job     |
| **POST** | `/upload-overlay`  | Upload an overlay asset      |
| **GET**  | `/status/{job_id}` | Check rendering progress (%) |
| **GET**  | `/result/{job_id}` | Download the final MP4       |

---
