from fastapi import APIRouter, UploadFile, File, Form, Response
from fastapi.responses import FileResponse
import shutil
import os
import sqlite3
import sys

# Adjust path to import utils from parent directory
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from db_utils import get_db_path, get_conn

router = APIRouter(prefix="/api/admin", tags=["admin"])

@router.get("/export_db")
async def export_db():
    db_path = get_db_path()
    if os.path.exists(db_path):
        return FileResponse(db_path, filename="pumps_backup.db", media_type="application/x-sqlite3")
    return Response(status_code=404, content="Database not found")

@router.post("/import_db")
async def import_db(file: UploadFile = File(...), merge: str = Form("false")):
    try:
        db_path = get_db_path()
        temp_path = db_path + ".tmp"
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Verify
        try:
            conn_chk = sqlite3.connect(temp_path)
            conn_chk.execute("SELECT count(*) FROM pumps")
            conn_chk.close()
        except Exception as e:
            if os.path.exists(temp_path): os.remove(temp_path)
            return Response(status_code=400, content=f"Invalid database file: {str(e)}")

        if merge.lower() == "true":
            # MERGE
            conn_src = sqlite3.connect(temp_path); conn_src.row_factory = sqlite3.Row
            rows = conn_src.execute("SELECT * FROM pumps").fetchall()
            src_cols = [d[0] for d in conn_src.execute("SELECT * FROM pumps LIMIT 1").description]
            conn_src.close()

            if not rows:
                if os.path.exists(temp_path): os.remove(temp_path)
                return {"status": "ok", "message": "Imported DB is empty"}

            conn_dest = get_conn()
            dest_cols = [row[1] for row in conn_dest.execute("PRAGMA table_info(pumps)").fetchall()]
            common_cols = [c for c in src_cols if c in dest_cols and c != 'id']

            if not common_cols:
                return {"status": "error", "message": "No common columns found"}

            col_names = ",".join(common_cols)
            placeholders = ",".join(["?"] * len(common_cols))
            sql = f"INSERT INTO pumps ({col_names}) VALUES ({placeholders})"

            count = 0
            for row in rows:
                conn_dest.execute(sql, [row[c] for c in common_cols])
                count += 1
            
            conn_dest.commit(); conn_dest.close()
            if os.path.exists(temp_path): os.remove(temp_path)
            return {"status": "ok", "message": f"Successfully merged {count} records."}
        else:
            # REPLACE
            shutil.move(temp_path, db_path)
            return {"status": "ok", "message": "Database replaced successfully"}
            
    except Exception as e:
        if os.path.exists(db_path + ".tmp"): os.remove(db_path + ".tmp")
        return {"status": "error", "message": str(e)}
