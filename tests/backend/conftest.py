import pytest
from httpx import AsyncClient, ASGITransport
import os
import sys

# Ensure backend dir is in path
BACKEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "backend")
sys.path.append(BACKEND_DIR)

# IMPORTANT: Mock DB paths or env here if needed to avoid touching production DB
os.environ["DB_DIR"] = "." # Local dir for tests

from main import app

@pytest.fixture
async def ac():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
