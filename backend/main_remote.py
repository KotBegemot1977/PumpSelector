from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import sys
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

# Configure path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(BASE_DIR)

from db_utils import init_db, UPLOAD_DIR
from routers import pumps, drawings, admin, selection

app = FastAPI(
    title="RusPump HQ-Chart Backend v2.36",
    redirect_slashes=False
)

# Path to frontend files
# Path to built frontend files (Vite build output)
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "../dist"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

# Mount Static Directories
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# Include Routers
app.include_router(pumps.router)
app.include_router(drawings.router)
app.include_router(admin.router)
app.include_router(selection.router)

@app.on_event("startup")
def on_startup():
    init_db()
    logger.info("Application Startup: DB Initialized.")

@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info(f"INCOMING: {request.method} {request.url.path} | Client: {request.client.host}")
    response = await call_next(request)
    logger.info(f"OUTGOING: {response.status_code}")
    return response

# Serve Assets (JS/CSS from Vite build)
if os.path.exists(FRONTEND_DIR):
    # Explicitly mount assets
    assets_dir = os.path.join(FRONTEND_DIR, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
    
    # Serve index.html on root
    @app.get("/")
    async def read_index():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
else:
    logger.warning(f"Frontend build directory not found at {FRONTEND_DIR}. Run 'npm run build' in frontend/.")
    @app.get("/")
    def read_root():
        return {"message": "Frontend not built. Please run 'npm run build' in frontend/ directory."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
