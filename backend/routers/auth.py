from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session, select
from db_utils import engine_pumps
from models import User, Organization
from auth_utils import get_password_hash, verify_password, create_access_token, get_current_active_user, get_current_admin
from pydantic import BaseModel, EmailStr
from typing import List, Optional
from sqlalchemy import text

router = APIRouter(prefix="/api/auth", tags=["auth"])

class UserRegister(BaseModel):
    email: EmailStr
    password: str
    org_name: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class UserOut(BaseModel):
    id: int
    email: str
    role: str
    org_id: Optional[int]

@router.post("/register", response_model=Token)
async def register(data: UserRegister):
    with Session(engine_pumps) as session:
        # Check if this is the first organization ever created
        first_org = session.exec(select(Organization)).first() is None
        
        # Check if user exists
        existing_user = session.exec(select(User).where(User.email == data.email)).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Email already registered")
        
        # Create Organization
        org = Organization(name=data.org_name, admin_email=data.email)
        session.add(org)
        session.commit()
        session.refresh(org)
        
        # Create Admin User
        user = User(
            email=data.email,
            hashed_password=get_password_hash(data.password),
            role="admin",
            org_id=org.id
        )
        session.add(user)
        session.commit()
        session.refresh(user)

        # MIGRATION: Adopt all records to the NEW organization
        try:
            session.execute(text("UPDATE pumps SET org_id = :org_id"), {"org_id": org.id})
            session.execute(text("UPDATE files SET org_id = :org_id"), {"org_id": org.id})
            session.commit()
            print(f"MIGRATION: All legacy data moved to NEW Organization ID {org.id}")
        except Exception as e:
            print(f"MIGRATION ERROR in adoption: {e}")
        
        access_token = create_access_token(data={"sub": user.email})
        return {"access_token": access_token, "token_type": "bearer"}

@router.post("/login", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    with Session(engine_pumps) as session:
        user = session.exec(select(User).where(User.email == form_data.username)).first()
        if not user or not verify_password(form_data.password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect email or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        access_token = create_access_token(data={"sub": user.email})
        return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me", response_model=UserOut)
async def read_users_me(current_user: User = Depends(get_current_active_user)):
    return current_user

@router.get("/users", response_model=List[UserOut])
async def list_org_users(admin: User = Depends(get_current_admin)):
    with Session(engine_pumps) as session:
        users = session.exec(select(User).where(User.org_id == admin.org_id)).all()
        return users

@router.post("/users", response_model=UserOut)
async def add_user_to_org(email: EmailStr, password: str, admin: User = Depends(get_current_admin)):
    with Session(engine_pumps) as session:
        existing = session.exec(select(User).where(User.email == email)).first()
        if existing:
            raise HTTPException(status_code=400, detail="User already exists")
        
        user = User(
            email=email,
            hashed_password=get_password_hash(password),
            role="user",
            org_id=admin.org_id
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        return user

@router.delete("/users/{user_id}")
async def remove_user_from_org(user_id: int, admin: User = Depends(get_current_admin)):
    with Session(engine_pumps) as session:
        user = session.get(User, user_id)
        if not user or user.org_id != admin.org_id:
            raise HTTPException(status_code=404, detail="User not found")
        if user.id == admin.id:
            raise HTTPException(status_code=400, detail="Cannot remove yourself")
        
        session.delete(user)
        session.commit()
        return {"status": "ok"}
