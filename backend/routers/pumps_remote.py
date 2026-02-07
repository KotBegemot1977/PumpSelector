from fastapi import APIRouter, UploadFile, File, Form, Request, Response
from typing import Optional
import json
import os
import sys
from datetime import datetime
from sqlmodel import Session, select

# Adjust path to import utils from parent directory
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(BASE_DIR)

from db_utils import get_conn, get_files_conn, get_sensitive_conn, UPLOAD_DIR, engine_pumps, engine_sensitive
from models import Pump, PrivateData
from calc_utils import get_fit, parse_float_list

router = APIRouter(prefix="/api", tags=["pumps"])

ALLOWED_EXTENSIONS = {'.pdf', '.png', '.jpg', '.jpeg', '.dwg'}

def validate_file_extension(filename: str):
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"File type '{ext}' is not allowed. Allowed: {', '.join(ALLOWED_EXTENSIONS)}")

@router.post("/calculate")
@router.get("/calculate")
async def calculate(
    request: Request,
    name: str = Form(""), oem_name: str = Form(""), company: str = Form(""), executor: str = Form(""),
    dn_suction: str = Form(""), dn_discharge: str = Form(""), rpm: str = Form(""),
    p2_nom: str = Form(""), impeller_actual: str = Form(""),
    q_text: str = Form(...), h_text: str = Form(...), npsh_text: str = Form(""),
    p2_text: str = Form(""), eff_text: str = Form(""),
    q_req: str = Form(""), h_req: str = Form(""),
    save: str = Form("false"),
    id: Optional[str] = Form(None),
    price: str = Form(""), currency: str = Form(""),
    comment: str = Form(""),
    q_min: str = Form("0"), q_max: str = Form("100"),
    h_min: str = Form("0"), h_max: str = Form("100"),
    h_st: str = Form("0"),
    drawing: Optional[UploadFile] = File(None),
    client_time: Optional[str] = Form(None),
    save_source: str = Form("points"),
    original_id: Optional[str] = Form(None)
):
    try:
        if q_text == "MODES":
            hc = json.loads(h_text)
            ec = json.loads(eff_text)
            pc = json.loads(p2_text)
            nc = json.loads(npsh_text)
            q = []
            q_min_val = float(q_min)
            q_max_val = float(q_max)
            h_min_val = float(h_min)
            h_max_val = float(h_max)
            q_req_val = float(q_req) if q_req else 0
            h_req_val = float(h_req) if h_req else 0
            h_st_val = float(h_st) if h_st else 0
        else:
            q = parse_float_list(q_text)
            hc = get_fit(q, h_text)
            ec = get_fit(q, eff_text)
            pc = get_fit(q, p2_text)
            nc = get_fit(q, npsh_text)
            
            h_points = parse_float_list(h_text)
            h_max_val = max(h_points) if h_points else 0
            h_min_val = min(h_points) if h_points else 0
            q_req_val = float(q_req) if q_req else 0
            h_req_val = float(h_req) if h_req else 0
            h_st_val = float(h_st) if h_st else 0
            q_max_val = max(q) if q else 0
            q_min_val = min(q) if q else 0

        # 3. Drawing File Logic
        draw_path = ""
        draw_filename = ""
        print(f"[DRAW DEBUG] Initial: path='', filename=''")
        
        if id and id != "NEW":
             conn = get_conn()
             exist = conn.execute("SELECT drawing_path, drawing_filename FROM pumps WHERE id=?", (id,)).fetchone()
             conn.close()
             if exist: 
                 draw_path = exist['drawing_path']
                 draw_filename = exist['drawing_filename']
                 print(f"[DRAW DEBUG] Loaded from existing ID={id}: path='{draw_path}', filename='{draw_filename}'")
        elif original_id:
             # Cloning case: use original drawing if no new one provided
             conn = get_conn()
             exist = conn.execute("SELECT drawing_path, drawing_filename FROM pumps WHERE id=?", (original_id,)).fetchone()
             conn.close()
             if exist:
                 draw_path = exist['drawing_path']
                 draw_filename = exist['drawing_filename']
                 print(f"[DRAW DEBUG] Cloned from original_id={original_id}: path='{draw_path}', filename='{draw_filename}'")

        if drawing:
            # SECURITY CHECK
            validate_file_extension(drawing.filename)

            conn_f = get_files_conn()
            cur_f = conn_f.cursor()
            file_bytes = await drawing.read()
            cur_f.execute("INSERT INTO files (filename, data) VALUES (?, ?)", (drawing.filename, file_bytes))
            fid = cur_f.lastrowid
            conn_f.commit(); conn_f.close()
            draw_path = f"/api/drawings/{fid}"
            draw_filename = drawing.filename
            print(f"[DRAW DEBUG] New file uploaded: path='{draw_path}', filename='{draw_filename}'")

        # 4. Save Logic
        res_id = "NEW"
        if id and id != "NEW": res_id = id

        if save.lower() == "true":
            conn = get_conn()
            cur = conn.cursor()
            
            # CRITICAL FAILSAFE: Always ensure filename matches the file in drawings.db
            if draw_path and draw_path.startswith("/api/drawings/"):
                 try:
                     fid = int(str(draw_path).split('/')[-1])
                     conn_f = get_files_conn()
                     fname_row = conn_f.execute("SELECT filename FROM files WHERE id=?", (fid,)).fetchone()
                     conn_f.close()
                     
                     if fname_row and fname_row[0]:
                         actual_filename = fname_row[0]
                         if draw_filename != actual_filename:
                             print(f"[DRAW DEBUG] CORRECTING filename: '{draw_filename}' -> '{actual_filename}'")
                             draw_filename = actual_filename
                         else:
                             print(f"[DRAW DEBUG] Filename already correct: '{draw_filename}'")
                     else:
                         print(f"[DRAW DEBUG] WARNING: File ID {fid} not found in drawings.db!")
                 except Exception as e:
                     print(f"[DRAW DEBUG] FAILSAFE error: {e}")

            print(f"[DRAW DEBUG] Final values before save: path='{draw_path}', filename='{draw_filename}'")

            # Sanitized Data for Public DB: Name=OEM, Price=0
            public_name = oem_name if oem_name else name 
            
            p_price = 0.0
            p_curr = ""
            
            # Current time (use client-side if provided)
            now_str = client_time if client_time else datetime.now().strftime("%d.%m.%Y %H:%M")

            common_params = (public_name, oem_name, company, executor, dn_suction, dn_discharge, rpm, p2_nom, impeller_actual, 
                 q_text, h_text, npsh_text, p2_text, eff_text, 
                 json.dumps(hc), json.dumps(ec), json.dumps(pc), json.dumps(nc), 
                 q_max_val, q_min_val, h_max_val, h_min_val, q_req_val, h_req_val, h_st_val,
                 draw_path, draw_filename, p_price, p_curr, comment, save_source)

            if id and id != "NEW":
                # UPDATE
                cur.execute("""UPDATE pumps SET 
                    name=?, oem_name=?, company=?, executor=?, dn_suction=?, dn_discharge=?, rpm=?, 
                    p2_nom=?, impeller_actual=?, q_text=?, h_text=?, npsh_text=?, p2_text=?, eff_text=?,
                    h_coeffs=?, eff_coeffs=?, p2_coeffs=?, npsh_coeffs=?,
                    q_max=?, q_min=?, h_max=?, h_min=?, q_req=?, h_req=?, h_st=?, drawing_path=?, drawing_filename=?,
                    price=?, currency=?, comment=?, save_source=?, updated_at=?
                    WHERE id=?""", common_params + (now_str, id))
                res_id = id
            else:
                # INSERT
                cur.execute("""INSERT INTO pumps (
                    name, oem_name, company, executor, dn_suction, dn_discharge, rpm, p2_nom, impeller_actual, 
                    q_text, h_text, npsh_text, p2_text, eff_text, 
                    h_coeffs, eff_coeffs, p2_coeffs, npsh_coeffs, 
                    q_max, q_min, h_max, h_min, q_req, h_req, h_st,
                    drawing_path, drawing_filename, price, currency, comment, save_source, created_at, updated_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                common_params + (now_str, now_str))
                res_id = cur.lastrowid
            
            conn.commit(); conn.close()
            
            # SAVE SENSITIVE DATA (Always update private DB if exists/createst)
            try:
                conn_s = get_sensitive_conn()
                conn_s.execute("INSERT OR REPLACE INTO private_data (id, original_name, price, currency) VALUES (?, ?, ?, ?)",
                               (res_id, name, float(price) if price else 0, currency))
                conn_s.commit(); conn_s.close()
            except Exception as e:
                print(f"Warning: Failed to save sensitive data: {e}")
            
        return {
            "id": res_id, "h_coeffs": hc, "eff_coeffs": ec, "p2_coeffs": pc, "npsh_coeffs": nc, 
            "q_max": q_max_val, "q_min": q_min_val, "draw_path": draw_path
        }
    except ValueError as val_err:
        return {"id": "ERROR", "message": str(val_err)}
    except Exception as e: 
        import traceback
        return {"id": "ERROR", "message": f"{str(e)} | {traceback.format_exc()}"}

@router.get("/pumps")
async def get_pumps(response: Response):
    # Prevent caching of the pump list to ensure fresh data (especially filenames)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"

    try:
        with Session(engine_pumps) as session:
            statement = select(Pump).order_by(Pump.id.desc())
            results = session.exec(statement).all()
            pumps_list = [p.model_dump() for p in results]
    except Exception as e:
        print(f"Error fetching pumps: {e}")
        return []

    # Try Fetch Sensitive Data
    try:
        with Session(engine_sensitive) as session:
            priv_data = session.exec(select(PrivateData)).all()
            sens_map = {r.id: r for r in priv_data}
        
            for p in pumps_list:
                if p["id"] in sens_map:
                    s = sens_map[p["id"]]
                    if s.original_name: p["name"] = s.original_name
                    if s.price: p["price"] = s.price
                    if s.currency: p["currency"] = s.currency
    except Exception as e:
        print(f"Sensitive DB Error: {e}")
        
    return pumps_list

@router.delete("/pumps/{id}")
async def delete_pump(id: int):
    try:
        conn = get_conn()
        row = conn.execute("SELECT drawing_path FROM pumps WHERE id=?", (id,)).fetchone()
        if not row:
            conn.close()
            return Response(status_code=404, content="Pump not found")
        
        path = row['drawing_path']
        
        conn.execute("DELETE FROM pumps WHERE id=?", (id,))
        conn.commit()
        
        # Check if file needs deletion (Garbage Collection)
        if path:
            # Check if anyone else uses this file
            usage = conn.execute("SELECT count(*) FROM pumps WHERE drawing_path=?", (path,)).fetchone()[0]
            if usage == 0:
                # Safe to delete
                if path.startswith("/api/drawings/"):
                    try:
                        fid = int(path.split("/")[-1])
                        cf = get_files_conn()
                        cf.execute("DELETE FROM files WHERE id=?", (fid,))
                        cf.commit(); cf.close()
                    except: pass
                elif path.startswith("/uploads/"):
                    try:
                        # Improved deletion logic using UPLOAD_DIR
                        fname = os.path.basename(path)
                        from db_utils import UPLOAD_DIR # ensure import here if needed or rely on top level
                        f_abs = os.path.join(UPLOAD_DIR, fname)
                        if os.path.exists(f_abs):
                            os.remove(f_abs)
                    except: pass
        
        conn.close()
        
        # DELETE FROM SENSITIVE DB
        try:
            cs = get_sensitive_conn()
            cs.execute("DELETE FROM private_data WHERE id=?", (id,))
            cs.commit(); cs.close()
        except: pass

        return {"status": "ok", "id": id}
    except Exception as e:
        return {"status": "error", "message": str(e)}
