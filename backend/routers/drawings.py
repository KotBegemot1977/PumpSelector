from fastapi import APIRouter, Response, Depends, HTTPException
from fastapi.responses import JSONResponse
import os
import sys
from datetime import datetime
from urllib.parse import quote
from auth_utils import get_current_active_user
from models import User

# Adjust path to import utils from parent directory
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(BASE_DIR)

from db_utils import get_files_conn

router = APIRouter(prefix="/api/drawings", tags=["drawings"])

@router.get("/{file_id}")
async def get_drawing(file_id: int, current_user: User = Depends(get_current_active_user)):
    try:
        conn = get_files_conn()
        # Security: check org_id or if it's a legacy public file (org_id IS NULL)
        row = conn.execute("SELECT filename, data FROM files WHERE id=? AND (org_id=? OR org_id IS NULL)", 
                           (file_id, current_user.org_id)).fetchone()
        conn.close()
        
        if not row:
            return Response(status_code=404, content="File not found or unauthorized")
            
        fname, data = row
        if not data:
            return Response(content="File data is empty", status_code=500)

        mime = "application/pdf" if fname.lower().endswith(".pdf") else "application/octet-stream"
        safe_fname = quote(fname)
        
        return Response(
            content=data,
            media_type=mime,
            headers={
                "Content-Disposition": f"inline; filename*=UTF-8''{safe_fname}",
                "Access-Control-Expose-Headers": "Content-Disposition"
            }
        )
    except Exception as e:
        import traceback
        err_msg = traceback.format_exc()
        print(f"DRAWING ERROR: {e}")
        return JSONResponse(status_code=500, content={"error": str(e), "traceback": err_msg})
