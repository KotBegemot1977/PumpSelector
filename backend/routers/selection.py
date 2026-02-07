from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import List, Optional
from pydantic import BaseModel
import json
import numpy as np

from db_utils import get_session, engine_pumps
from models import Pump
from calc_utils import parse_float_list

router = APIRouter(prefix="/api/selection", tags=["selection"])

class SearchRequest(BaseModel):
    q_req: float
    h_req: float
    tolerance_percent: float = 10.0  # Default 10%

class SearchResult(BaseModel):
    pump: dict
    h_at_point: float
    deviation_percent: float
    power_at_point: Optional[float] = None
    eff_at_point: Optional[float] = None
    rpm: Optional[str] = None

def poly_val(coeffs: List[float], x: float) -> float:
    # Backend calc_utils uses [a3, a2, a1, a0] (numpy polyfit standard for high->low)
    # y = a3*x^3 + a2*x^2 + a1*x + a0
    val = 0.0
    degree = len(coeffs) - 1
    for i, c in enumerate(coeffs):
        val += c * (x ** (degree - i))
    return val

@router.post("/search", response_model=List[SearchResult])
async def search_pumps(req: SearchRequest, session: Session = Depends(get_session)):
    results = []
    
    # Use injected session (which uses engine_pumps normally, but overridden in tests)
    pumps = session.exec(select(Pump)).all()
    
    for pump in pumps:

            # 1. Check Q Range
            # If q_max is 0, we might skip or assume it's valid if coeffs exist. 
            # Ideally strict check: q_req <= q_max * 1.2 (some overload allowed?)
            # Let's stick to strict or slightly flexible
            if pump.q_max > 0 and req.q_req > pump.q_max * 1.15:
                continue

            # 2. Parse H Coeffs
            try:
                # Coefficients are stored as space-separated string or JSON string of list
                # check models.py: h_coeffs: Optional[str]
                if not pump.h_coeffs:
                    continue
                
                # Check if it looks like JSON list "[-0.1, ...]" or space string "-0.1 ..."
                if pump.h_coeffs.strip().startswith('['):
                    coeffs = json.loads(pump.h_coeffs)
                else:
                    coeffs = parse_float_list(pump.h_coeffs)
                
                if not coeffs: continue

                # 3. Calculate H at Q_req
                h_calc = poly_val(coeffs, req.q_req)
                
                # 4. Check Deviation
                # deviation = abs(h_calc - h_req) / h_req * 100
                if req.h_req == 0: continue # avert div by zero
                
                diff = h_calc - req.h_req
                deviation = (abs(diff) / req.h_req) * 100
                
                if deviation <= req.tolerance_percent:
                    # Found match!
                    
                    # Calc Power & Eff if available
                    p2_val = None
                    eff_val = None
                    
                    if pump.p2_coeffs:
                        p2_c = parse_float_list(pump.p2_coeffs) if not pump.p2_coeffs.startswith('[') else json.loads(pump.p2_coeffs)
                        if p2_c: p2_val = poly_val(p2_c, req.q_req)

                    if pump.eff_coeffs:
                        eff_c = parse_float_list(pump.eff_coeffs) if not pump.eff_coeffs.startswith('[') else json.loads(pump.eff_coeffs)
                        if eff_c: eff_val = poly_val(eff_c, req.q_req)

                    results.append(SearchResult(
                        pump=pump.model_dump(),
                        h_at_point=h_calc,
                        deviation_percent=deviation,
                        power_at_point=p2_val,
                        eff_at_point=eff_val,
                        rpm=pump.rpm
                    ))

            except Exception as e:
                print(f"Error processing pump {pump.id}: {e}")
                continue

    # Sort by deviation
    results.sort(key=lambda x: x.deviation_percent)
    
    return results
