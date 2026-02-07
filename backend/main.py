from fastapi import FastAPI, Request, Depends
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from models import User
from auth_utils import get_current_active_user
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
from routers import pumps, drawings, admin, selection, auth

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
app.include_router(auth.router)

@app.get("/api/debug-db-stats")
async def debug_db_stats():
    from db_utils import get_conn, get_db_path
    try:
        conn = get_conn()
        pumps_count = conn.execute("SELECT count(*) FROM pumps").fetchone()[0]
        orphans_count = conn.execute("SELECT count(*) FROM pumps WHERE org_id IS NULL").fetchone()[0]
        
        # Orgs
        orgs_count = 0
        orgs_list = []
        try:
            orgs = conn.execute("SELECT id, name FROM organizations").fetchall()
            orgs_count = len(orgs)
            orgs_list = [{"id": r[0], "name": r[1]} for r in orgs]
        except: pass

        # Users
        users_list = []
        try:
            users = conn.execute("SELECT email, org_id FROM users").fetchall()
            users_list = [{"email": r[0], "org_id": r[1]} for r in users]
        except: pass
            
        # Pumps per Org
        pumps_per_org = []
        pumps_sample = []
        try:
            stats = conn.execute("SELECT org_id, count(*) FROM pumps GROUP BY org_id").fetchall()
            pumps_per_org = [{"org_id": r[0], "count": r[1]} for r in stats]
            
            sample = conn.execute("SELECT id, name, org_id FROM pumps LIMIT 5").fetchall()
            for s in sample:
                pumps_sample.append({
                    "id": s[0], 
                    "name": s[1], 
                    "org_id": s[2], 
                    "org_id_type": str(type(s[2]))
                })
        except: pass
            
        distinct_orgs = conn.execute("SELECT DISTINCT org_id FROM pumps").fetchall()
        org_ids = [r[0] for r in distinct_orgs]
        conn.close()
        
        return {
            "total_pumps": pumps_count,
            "orphans": orphans_count,
            "total_orgs": orgs_count,
            "orgs": orgs_list,
            "users": users_list,
            "pumps_per_org": pumps_per_org,
            "pumps_sample": pumps_sample,
            "used_org_ids": org_ids,
            "db_path": os.path.abspath(get_db_path())
        }
    except Exception as e:
        logger.error(f"DEBUG STATS ERROR: {e}")
        return {"error": str(e)}

@app.get("/api/self-check")
async def self_check(current_user: User = Depends(get_current_active_user)):
    from db_utils import get_conn
    conn = get_conn()
    count = conn.execute("SELECT count(*) FROM pumps WHERE org_id = ?", (current_user.org_id,)).fetchone()[0]
    conn.close()
    return {
        "user": current_user.email,
        "org_id": current_user.org_id,
        "org_id_type": str(type(current_user.org_id)),
        "pumps_found": count
    }

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
