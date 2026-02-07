from typing import Optional
from sqlmodel import Field, SQLModel
from datetime import datetime

class PumpBase(SQLModel):
    name: str = Field(index=True)
    oem_name: Optional[str] = None
    company: Optional[str] = None
    executor: Optional[str] = None
    
    # Technical Specs
    dn_suction: Optional[str] = None
    dn_discharge: Optional[str] = None
    rpm: Optional[str] = None
    p2_nom: Optional[str] = None
    impeller_actual: Optional[str] = None
    
    # Raw Data Points (stored as text/JSON)
    q_text: Optional[str] = None
    h_text: Optional[str] = None
    npsh_text: Optional[str] = None
    p2_text: Optional[str] = None
    eff_text: Optional[str] = None
    
    # Coefficients (stored as text/JSON)
    h_coeffs: Optional[str] = None
    eff_coeffs: Optional[str] = None
    p2_coeffs: Optional[str] = None
    npsh_coeffs: Optional[str] = None
    
    # Limits and Operating Point
    q_max: float = 0.0
    q_min: float = 0.0
    h_max: float = 0.0
    h_min: float = 0.0
    q_req: float = 0.0
    h_req: float = 0.0
    h_st: float = Field(default=0.0) # From recent changes
    
    # Files
    drawing_path: Optional[str] = None
    drawing_filename: Optional[str] = None
    
    # Commercial & Meta
    price: float = 0.0
    currency: Optional[str] = None
    comment: Optional[str] = None
    save_source: Optional[str] = "points"
    
    updated_at: Optional[str] = None

class Pump(PumpBase, table=True):
    __tablename__ = "pumps"
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: Optional[str] = Field(default_factory=lambda: datetime.now().strftime("%d.%m.%Y %H:%M"))

class PrivateData(SQLModel, table=True):
    __tablename__ = "private_data"
    id: Optional[int] = Field(default=None, primary_key=True)
    original_name: Optional[str] = None
    price: float = 0.0
    currency: Optional[str] = None

class File(SQLModel, table=True):
    __tablename__ = "files"
    id: Optional[int] = Field(default=None, primary_key=True)
    filename: Optional[str] = None
    data: bytes

