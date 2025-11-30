import os
import shutil
import uuid
import json
import subprocess
import uvicorn
import re
import sys
from pathlib import Path
from typing import List, Optional
from datetime import datetime

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ============================================================================
# CONFIGURATION & SETUP
# ============================================================================

app = FastAPI(title="Video Editor Backend", version="2.2.0")

# 🛠️ CRITICAL CHECK: FFmpeg
if not shutil.which("ffmpeg"):
    print("❌ CRITICAL ERROR: FFmpeg is not found in system PATH.")
    print("   Please install FFmpeg or add it to your Environment Variables.")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Directory setup
BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads" / "videos"
OVERLAY_DIR = BASE_DIR / "uploads" / "overlays"
OUTPUT_DIR = BASE_DIR / "outputs"
JOBS_DIR = BASE_DIR / "jobs"

# 🚀 BOSS MOVE: Clean up old jobs on server restart (Fixes 404/JSON errors)
if JOBS_DIR.exists():
    print("🧹 Cleaning up old job statuses...")
    for file in JOBS_DIR.glob("*"):
        try:
            file.unlink()
        except Exception:
            pass

# Create directories
for d in [UPLOAD_DIR, OVERLAY_DIR, OUTPUT_DIR, JOBS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# ============================================================================
# MODELS
# ============================================================================

class OverlayMetadata(BaseModel):
    id: Optional[str] = None
    type: str          # "text", "image", "video"
    content: str       # text content or filename
    start_time: float 
    end_time: float    
    x: float 
    y: float 
    width: Optional[float] = 0.2
    height: Optional[float] = 0.2 

class JobStatus(BaseModel):
    job_id: str
    status: str
    progress: int
    error: Optional[str] = None

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def save_job_status(job_id: str, status: str, progress: int = 0, error: str = None):
    data = {
        "job_id": job_id,
        "status": status,
        "progress": progress,
        "error": error,
        "updated_at": datetime.now().isoformat()
    }
    with open(JOBS_DIR / f"{job_id}.json", "w") as f:
        json.dump(data, f)

# 🛠️ FIX: Crash-Proof Loader
def load_job_status(job_id: str) -> dict:
    job_file = JOBS_DIR / f"{job_id}.json"
    if job_file.exists():
        try:
            with open(job_file, "r") as f:
                content = f.read().strip()
                if not content:
                    return None # File is empty (race condition), return None to retry
                return json.loads(content)
        except json.JSONDecodeError:
            return None # Corrupted file, retry next poll
    return None

def get_video_duration(input_path: Path) -> float:
    cmd = [
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', str(input_path)
    ]
    try:
        return float(subprocess.check_output(cmd).strip())
    except Exception as e:
        print(f"⚠️ Error getting duration: {e}")
        return 0.0

def time_str_to_sec(time_str: str) -> float:
    try:
        h, m, s = time_str.split(':')
        return int(h) * 3600 + int(m) * 60 + float(s)
    except:
        return 0.0

def process_video_task(job_id: str, video_path: Path, overlays: List[OverlayMetadata]):
    try:
        output_path = OUTPUT_DIR / f"{job_id}.mp4"
        
        # 1. Probe Info
        total_duration = get_video_duration(video_path)
        if total_duration == 0:
            raise Exception("Could not determine video duration. Is the file corrupted?")

        # Get Dimensions
        cmd_probe = [
            'ffprobe', '-v', 'error', '-select_streams', 'v:0', 
            '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', 
            str(video_path)
        ]
        probe_out = subprocess.check_output(cmd_probe).decode().strip()
        if not probe_out:
             raise Exception("Could not determine video dimensions.")
        W, H = map(int, probe_out.split('x'))

        # 2. Build Filter
        input_args = ['-i', str(video_path)]
        filter_complex = ""
        last_stream_label = "[0:v]" 
        
        save_job_status(job_id, "processing", 0)

        for i, ov in enumerate(overlays):
            x_px = int(ov.x * W)
            y_px = int(ov.y * H)
            
            if ov.type == 'text':
                font_size = max(16, int((ov.height or 0.05) * H))
                safe_text = ov.content.replace("'", "'\\''").replace(":", "\\:")
                next_label = f"[v{i+1}]"
                filter_complex += (
                    f"{last_stream_label}drawtext=text='{safe_text}':"
                    f"fontcolor=white:fontsize={font_size}:x={x_px}:y={y_px}:"
                    f"enable='between(t,{ov.start_time},{ov.end_time})'{next_label};"
                )
                last_stream_label = next_label

            elif ov.type in ['image', 'video']:
                ov_path = OVERLAY_DIR / ov.content
                if not ov_path.exists():
                    print(f"⚠️ Overlay file missing: {ov_path}")
                    continue

                input_args.extend(['-i', str(ov_path)])
                input_index = len(input_args) // 2 - 1 

                target_w = int((ov.width or 0.2) * W)
                target_h = int((ov.height or 0.2) * H)
                if target_w % 2 != 0: target_w -= 1
                if target_h % 2 != 0: target_h -= 1

                scaled_label = f"[sc{i}]"
                next_label = f"[v{i+1}]"

                filter_complex += f"[{input_index}:v]scale={target_w}:{target_h}{scaled_label};"
                filter_complex += (
                    f"{last_stream_label}{scaled_label}overlay={x_px}:{y_px}:"
                    f"enable='between(t,{ov.start_time},{ov.end_time})'{next_label};"
                )
                last_stream_label = next_label
        
        filter_complex = filter_complex.rstrip(';')
        if not filter_complex:
            filter_complex = "null"

        # 3. FFmpeg Command
        cmd = [
            'ffmpeg', '-y',
            *input_args,
            '-filter_complex', filter_complex,
            '-map', last_stream_label,
            '-map', '0:a?', 
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-c:a', 'aac',
            str(output_path)
        ]

        print(f"🎬 Processing Job {job_id}...")
        
        process = subprocess.Popen(
            cmd, 
            stderr=subprocess.PIPE, 
            universal_newlines=True
        )

        time_pattern = re.compile(r"time=(\d{2}:\d{2}:\d{2}\.\d{2})")
        
        for line in process.stderr:
            match = time_pattern.search(line)
            if match:
                current_sec = time_str_to_sec(match.group(1))
                if total_duration > 0:
                    percent = int((current_sec / total_duration) * 100)
                    save_job_status(job_id, "processing", min(percent, 99))

        process.wait()

        if process.returncode == 0:
            save_job_status(job_id, "completed", 100)
            print(f"✅ Job {job_id} Success!")
        else:
            raise Exception("FFmpeg process failed")

    except Exception as e:
        print(f"❌ Job {job_id} Failed: {e}")
        save_job_status(job_id, "failed", 0, str(e))

# ============================================================================
# API
# ============================================================================

@app.get("/")
async def root():
    return {"status": "running"}

@app.post("/upload")
async def upload_video(background_tasks: BackgroundTasks, video: UploadFile = File(...), overlays: str = Form("[]")):
    try:
        job_id = str(uuid.uuid4())
        video_path = UPLOAD_DIR / f"{job_id}_{video.filename}"
        
        with open(video_path, "wb") as f:
            shutil.copyfileobj(video.file, f)
        
        try:
            raw_overlays = json.loads(overlays)
            overlay_data = [OverlayMetadata(**item) for item in raw_overlays]
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON overlays")
        
        save_job_status(job_id, "processing", 0)
        background_tasks.add_task(process_video_task, job_id, video_path, overlay_data)
        
        return {"job_id": job_id, "status": "processing"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/upload-overlay")
async def upload_overlay(overlay: UploadFile = File(...), type: str = Form("image")):
    try:
        ext = Path(overlay.filename).suffix
        filename = f"{uuid.uuid4()}{ext}"
        path = OVERLAY_DIR / filename
        
        with open(path, "wb") as f:
            shutil.copyfileobj(overlay.file, f)
            
        return {"filename": filename, "type": type}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/status/{job_id}")
async def get_status(job_id: str):
    status = load_job_status(job_id)
    if not status: raise HTTPException(status_code=404, detail="Job not found")
    return status

@app.get("/result/{job_id}")
async def get_result(job_id: str):
    status = load_job_status(job_id)
    if not status: raise HTTPException(status_code=404, detail="Job not found")
    if status["status"] != "completed": raise HTTPException(status_code=400, detail="Not ready")
    
    output_path = OUTPUT_DIR / f"{job_id}.mp4"
    if not output_path.exists(): raise HTTPException(status_code=404, detail="File missing")
    
    return FileResponse(path=output_path, media_type="video/mp4", filename=f"render_{job_id}.mp4")

@app.get("/jobs")
async def list_jobs():
    jobs_list = []
    for job_file in JOBS_DIR.glob("*.json"):
        with open(job_file, "r") as f:
            jobs_list.append(json.load(f))
    return {"count": len(jobs_list), "jobs": jobs_list}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)